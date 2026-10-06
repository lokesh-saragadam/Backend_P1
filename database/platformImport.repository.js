const { prisma } = require('./client');
const HttpError = require('../utils/httpError');
const normalizeVerdict = require('../utils/normalizeVerdict');

async function ensurePlatforms(tx, platformHandles) {
    const platformsByName = new Map();
    for (const name of Object.keys(platformHandles)) {
        const platform = await tx.platform.upsert({ where: { name }, update: {}, create: { name } });
        platformsByName.set(name, platform.platformId);
    }
    return platformsByName;
}
async function upsertUserHandle(tx, userId, platformId, handle, contestRating) {
    const where = { userId_platformId: { userId, platformId } };
    const existingHandle = await tx.userHandle.findUnique({ where });
    if (existingHandle && existingHandle.handle !== handle) {
        throw new HttpError(409, 'This account already has a different handle linked to this platform.', 'HANDLE_ALREADY_LINKED');
    }
    await tx.userHandle.upsert({
        where, create: { userId, platformId, handle, contestRating }, update: { contestRating }
    });
}
async function upsertProblems(tx, platformId, problems) {
    for (let offset = 0; offset < problems.length; offset += 500) {
        const batch = problems.slice(offset, offset + 500);
        const existingProblems = await tx.problem.findMany({
            where: { platformId, platformProblemId: { in: batch.map(problem => problem.platformProblemId) } }
        });
        const existingById = new Map(existingProblems.map(problem => [problem.platformProblemId, problem]));
        const missingProblems = [];
        for (const problem of batch) {
            const metadata = {
                title: problem.title, difficulty: problem.difficulty ?? null,
                problemRating: problem.problemRating ?? null, tags: problem.tags,
                ...(problem.canonicalUrl ? { canonicalUrl: problem.canonicalUrl } : {}),
                ...(problem.metadataSource ? { metadataSource: problem.metadataSource } : {})
            };
            const existingProblem = existingById.get(problem.platformProblemId);
            if (!existingProblem) {
                missingProblems.push({ platformId, platformProblemId: problem.platformProblemId, ...metadata,
                    ...(problem.canonicalUrl || problem.metadataSource ? { metadataUpdatedAt: new Date() } : {}) });
            } else if (Object.entries(metadata).some(([field, value]) =>
                JSON.stringify(existingProblem[field]) !== JSON.stringify(value))) {
                await tx.problem.update({ where: { problemId: existingProblem.problemId }, data: { ...metadata,
                    ...(problem.canonicalUrl || problem.metadataSource ? { metadataUpdatedAt: new Date() } : {}) } });
            }
        }
        if (missingProblems.length) await tx.problem.createMany({ data: missingProblems, skipDuplicates: true });
    }
}
async function insertSubmissions(tx, userId, platformId, submissions, problemIdByPlatformProblemId) {
    for (let offset = 0; offset < submissions.length; offset += 500) {
        const batch = submissions.slice(offset, offset + 500).map(submission => {
            const problemId = problemIdByPlatformProblemId.get(submission.platformProblemId);
            if (!problemId) throw new HttpError(502, 'Some submission problems could not be resolved. Please retry the import.', 'UNRESOLVED_SUBMISSION');
            const legacyKey = `${userId}_${problemId}_${submission.submittedAtMs}`;
            return { ...submission, problemId, legacyKey,
                nativeKey: `native:${userId}:${platformId}:${submission.platformSubmissionId}` };
        });
        const existingSubmissions = await tx.submission.findMany({
            where: { userId, problem: { platformId },
                deduplicationKey: { in: batch.flatMap(submission => [submission.nativeKey, submission.legacyKey]) } }
        });
        const existingByKey = new Map(existingSubmissions.map(row => [row.deduplicationKey, row]));
        const pendingInserts = new Map();
        const claimedLegacyKeys = new Set();
        for (const submission of batch) {
            const existing = existingByKey.get(submission.nativeKey) ||
                (!claimedLegacyKeys.has(submission.legacyKey) && existingByKey.get(submission.legacyKey));
            const data = {
                userId, problemId: submission.problemId, deduplicationKey: submission.nativeKey,
                verdict: submission.verdict, language: submission.language,
                submittedAtMs: BigInt(submission.submittedAtMs),
                normalizedVerdict: normalizeVerdict(submission.verdict),
                platformSubmissionId: submission.platformSubmissionId,
                source: 'platform_sync'
            };
            if (existing) {
                if (existing.deduplicationKey === submission.legacyKey) claimedLegacyKeys.add(submission.legacyKey);
                if (existing.problemId !== submission.problemId) {
                    throw new HttpError(502, 'A platform submission could not be matched safely.', 'SUBMISSION_IDENTITY_CONFLICT');
                }
                if (existing.deduplicationKey !== data.deduplicationKey || existing.verdict !== data.verdict ||
                    existing.language !== data.language || existing.submittedAtMs !== data.submittedAtMs || existing.normalizedVerdict !== data.normalizedVerdict) {
                    await tx.submission.update({ where: { submissionId: existing.submissionId }, data });
                }
                // Claim a legacy timestamp-only row once, then identify it by its native event key.
                existingByKey.delete(existing.deduplicationKey);
                Object.assign(existing, data);
                existingByKey.set(submission.nativeKey, existing);
            } else {
                pendingInserts.set(submission.nativeKey, { ...data, deduplicationKey: submission.nativeKey });
            }
        }
        if (pendingInserts.size) {
            await tx.submission.createMany({ data: [...pendingInserts.values()], skipDuplicates: true });
        }
    }
}
async function persistPlatformHistory(tx, userId, platformId, platformImport) {
    await upsertProblems(tx, platformId, platformImport.problems);
    const platformProblemIds = [...new Set(platformImport.submissions.map(submission => submission.platformProblemId))];
    const problemIdByPlatformProblemId = new Map();
    for (let offset = 0; offset < platformProblemIds.length; offset += 500) {
        const problems = await tx.problem.findMany({
            where: { platformId, platformProblemId: { in: platformProblemIds.slice(offset, offset + 500) } },
            select: { problemId: true, platformProblemId: true }
        });
        for (const problem of problems) problemIdByPlatformProblemId.set(problem.platformProblemId, problem.problemId);
    }
    await insertSubmissions(tx, userId, platformId, platformImport.submissions, problemIdByPlatformProblemId);
}
async function persistUserPlatformHistory(userId, platformHandles, leetcodeImport, codeforcesImport) {
    // Serializable retries make overlapping syncs and legacy-ID reconciliation safe.
    // console.log("Persisting user syncs .. ");
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await prisma.$transaction(async tx => {
                const platformsByName = await ensurePlatforms(tx, platformHandles);
                for (const [name, platformImport] of [['Leetcode', leetcodeImport], ['Codeforces', codeforcesImport]]) {
                    const platformId = platformsByName.get(name);
                    // console.log("Entering upsert User Handle");
                    await upsertUserHandle(tx, userId, platformId, platformHandles[name], platformImport.contestRating ?? null);
                    // console.log("Persisting platform history");
                    await persistPlatformHistory(tx, userId, platformId, platformImport);
                    // console.log("Both done for transaction.")
                }
            }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 60000 });
        } catch (error) {
            console.log(error);
            if (error.code !== 'P2034' || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
    }
}
module.exports = { persistUserPlatformHistory, persistPlatformHistory, insertSubmissions };

const { prisma } = require('./client');
const HttpError = require('../utils/httpError');

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
                ...(problem.titleSlug ? { titleSlug: problem.titleSlug } : {})
            };
            const existingProblem = existingById.get(problem.platformProblemId);
            if (!existingProblem) {
                missingProblems.push({ platformId, platformProblemId: problem.platformProblemId, ...metadata });
            } else if (Object.entries(metadata).some(([field, value]) =>
                JSON.stringify(existingProblem[field]) !== JSON.stringify(value))) {
                await tx.problem.update({ where: { problemId: existingProblem.problemId }, data: metadata });
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
            where: { userId, problem: { platformId }, OR: [
                { deduplicationKey: { in: batch.map(submission => submission.legacyKey) } },
                { platformSubmissionId: { in: batch.map(submission => submission.platformSubmissionId) } }
            ] }
        });
        const existingByNativeId = new Map(existingSubmissions.filter(row => row.platformSubmissionId)
            .map(row => [row.platformSubmissionId, row]));
        const existingByKey = new Map(existingSubmissions.map(row => [row.deduplicationKey, row]));
        const pendingInserts = new Map();
        for (const submission of batch) {
            const existing = existingByNativeId.get(submission.platformSubmissionId) ||
                existingByKey.get(submission.legacyKey);
            const data = {
                userId, problemId: submission.problemId, platformSubmissionId: submission.platformSubmissionId,
                verdict: submission.verdict, language: submission.language,
                submittedAtMs: BigInt(submission.submittedAtMs)
            };
            if (existing && (!existing.platformSubmissionId || existing.platformSubmissionId === submission.platformSubmissionId)) {
                if (existing.problemId !== submission.problemId) {
                    throw new HttpError(502, 'A platform submission could not be matched safely.', 'SUBMISSION_IDENTITY_CONFLICT');
                }
                if (existing.platformSubmissionId !== data.platformSubmissionId || existing.verdict !== data.verdict ||
                    existing.language !== data.language || existing.submittedAtMs !== data.submittedAtMs) {
                    await tx.submission.update({ where: { submissionId: existing.submissionId }, data });
                }
                // Claim a legacy row only once, including when two events share the same second.
                Object.assign(existing, data);
                existingByNativeId.set(submission.platformSubmissionId, existing);
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
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await prisma.$transaction(async tx => {
                const platformsByName = await ensurePlatforms(tx, platformHandles);
                for (const [name, platformImport] of [['Leetcode', leetcodeImport], ['Codeforces', codeforcesImport]]) {
                    const platformId = platformsByName.get(name);
                    await upsertUserHandle(tx, userId, platformId, platformHandles[name], platformImport.contestRating ?? null);
                    await persistPlatformHistory(tx, userId, platformId, platformImport);
                }
            }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
        } catch (error) {
            if (error.code !== 'P2034' || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
    }
}
module.exports = { persistUserPlatformHistory, persistPlatformHistory, insertSubmissions };

const { prisma } = require('../database/client');
const asyncHandler = require('express-async-handler');
const { collectCodeforcesImportData } = require('../services/codeforces.service');
const { collectLeetCodeImportData } = require('../services/leetcode.service');
const { persistUserPlatformHistory } = require('../database/platformImport.repository');
const HttpError = require('../utils/httpError');
// Reject control bytes in externally supplied text fields.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f]/;

const listProblems = asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0) {
        throw new HttpError(400, 'Use a limit from 1 to 100 and a non-negative offset.', 'INVALID_PAGINATION');
    }
    const result = await prisma.problem.findMany({
        take: limit, skip: offset, orderBy: { problemId: 'asc' }
    });
    res.json(result);
});

const importLinkedPlatformHistory = asyncHandler(async (req, res) => {
    const platformHandles = req.body?.platforms;
    // Both handles are required by the existing importer. Independent linking is deferred.
    if (!platformHandles || Array.isArray(platformHandles) ||
        Object.keys(platformHandles).some(key => !['Leetcode', 'Codeforces'].includes(key)) ||
        !['Leetcode', 'Codeforces'].every(key => typeof platformHandles[key] === 'string' &&
            /^[A-Za-z0-9_.-]{1,100}$/.test(platformHandles[key]))) {
        throw new HttpError(400, 'Enter valid LeetCode and Codeforces handles. Please try again.', 'INVALID_HANDLES');
    }
    let leetcodeImport, codeforcesImport;
    try {
        leetcodeImport = await collectLeetCodeImportData(platformHandles.Leetcode);
        codeforcesImport = await collectCodeforcesImportData(platformHandles.Codeforces);
        if (![leetcodeImport, codeforcesImport].every(data => data &&
            Array.isArray(data.problems) && Array.isArray(data.submissions))) throw new Error();
    } catch (error) {
        if (error.name?.startsWith('Prisma') || /^P\d{4}$/.test(error.code || '')) throw error;
        throw new HttpError(502, 'Could not import platform data. Check both handles and try again.', 'PLATFORM_IMPORT_FAILED');
    }
    await persistUserPlatformHistory(req.user.userId, platformHandles, leetcodeImport, codeforcesImport);
    res.json({ success: true, message: 'Your platform data has been imported.' });
});

const importClientSubmissions = asyncHandler(async (req, res) => {
    const { platform, submissions } = req.body || {};
    if (!['Leetcode', 'Codeforces'].includes(platform) || !Array.isArray(submissions) ||
        submissions.length < 1 || submissions.length > 500) {
        throw new HttpError(400, 'Choose a supported platform and send between 1 and 500 submissions.', 'INVALID_IMPORT');
    }
    const earliest = Date.UTC(2000, 0, 1);
    const latest = Date.now() + 24 * 60 * 60 * 1000;
    const records = submissions.map(record => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new HttpError(400, 'Every submission must be an object.', 'INVALID_SUBMISSION');
        }
        // Accept legacy extension field names until its integration is updated.
        const rawPlatformProblemId = record.platformProblemId ?? record.problemcode;
        const rawSubmittedAtMs = record.submittedAtMs ?? record.timestamp;
        const verdict = record.verdict ?? record.status;
        const { language } = record;
        const platformProblemId = typeof rawPlatformProblemId === 'number' && Number.isSafeInteger(rawPlatformProblemId)
            ? String(rawPlatformProblemId) : rawPlatformProblemId;
        const submittedAtMs = typeof rawSubmittedAtMs === 'string' && /^\d{13}$/.test(rawSubmittedAtMs)
            ? Number(rawSubmittedAtMs) : rawSubmittedAtMs;
        if (typeof platformProblemId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(platformProblemId) ||
            typeof verdict !== 'string' || !verdict.trim() || verdict.length > 50 ||
            CONTROL_CHARACTERS.test(verdict) ||
            (language != null && (typeof language !== 'string' || language.length > 50 ||
                CONTROL_CHARACTERS.test(language))) ||
            !Number.isSafeInteger(submittedAtMs) || submittedAtMs < earliest || submittedAtMs > latest) {
            throw new HttpError(400, 'Check submission IDs, verdict, language and timestamps (Unix milliseconds).', 'INVALID_SUBMISSION');
        }
        return { platformProblemId, verdict: verdict.trim(), language: language || null, submittedAtMs };
    });
    const platformData = await prisma.platform.findUnique({ where: { name: platform } });
    if (!platformData) {
        throw new HttpError(400, 'Connect this platform before importing submissions.', 'PLATFORM_NOT_FOUND');
    }
    const problems = await prisma.problem.findMany({
        where: { platformId: platformData.platformId, platformProblemId: { in: [...new Set(records.map(r => r.platformProblemId))] } },
        select: { problemId: true, platformProblemId: true }
    });
    const problemIdByPlatformProblemId = new Map(problems.map(problem => [problem.platformProblemId, problem.problemId]));
    if (records.some(record => !problemIdByPlatformProblemId.has(record.platformProblemId))) {
        throw new HttpError(422, 'Some problems are not in the catalog. Sync platform data before importing this batch.', 'UNKNOWN_PROBLEMS');
    }
    // Metadata from the client is deliberately ignored. Only server connectors
    // may create/update the shared catalog; these events remain client supplied.
    await prisma.$transaction(async tx => {
        for (const record of records) {
            const problemId = problemIdByPlatformProblemId.get(record.platformProblemId);
            // The legacy extension has no native event identity. Do not duplicate or
            // overwrite a trusted event already recorded for this problem and timestamp.
            const trustedEvent = await tx.submission.findFirst({
                where: { userId: req.user.userId, problemId, submittedAtMs: BigInt(record.submittedAtMs),
                    platformSubmissionId: { not: null } }, select: { submissionId: true }
            });
            if (trustedEvent) continue;
            const deduplicationKey = `${req.user.userId}_${problemId}_${record.submittedAtMs}`;
            await tx.submission.upsert({
                where: { deduplicationKey },
                create: {
                    userId: req.user.userId, problemId, deduplicationKey,
                    verdict: record.verdict, language: record.language, submittedAtMs: BigInt(record.submittedAtMs)
                },
                update: { verdict: record.verdict, language: record.language }
            });
        }
    });
    res.json({ success: true, result: { submissionsProcessed: records.length, problemsProcessed: problemIdByPlatformProblemId.size } });
});
module.exports = { listProblems, importLinkedPlatformHistory, importClientSubmissions };

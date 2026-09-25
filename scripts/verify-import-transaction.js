// Creates synthetic records inside one transaction and ALWAYS rolls it back.
// PostgreSQL sequence counters can advance; no test rows are retained.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../database/client');
const { persistPlatformHistory } = require('../database/platformImport.repository');
const { getErrorDiagnosticCode } = require('../utils/errorDiagnostics');
const rollback = new Error('ROLLBACK_VERIFICATION');
async function main() {
    try {
        await prisma.$transaction(async tx => {
            const suffix = randomUUID();
            const user = await tx.user.create({ data: { username: 'verify-' + suffix,
                email: suffix + '@example.test', passwordHash: 'not-a-login-password' } });
            const platform = await tx.platform.create({ data: { name: 'verify-' + suffix } });
            const problem = { platformProblemId: '1', title: 'Synthetic verification problem',
                difficulty: 'Easy', problemRating: null, tags: ['array'] };
            const submittedAtMs = Date.UTC(2026, 0, 1);
            const event = id => ({ platformProblemId: '1', platformSubmissionId: String(id),
                submittedAtMs, verdict: 'Accepted', language: 'python3' });
            const payload = { problems: [problem], submissions: [event(1), event(2)] };
            await persistPlatformHistory(tx, user.userId, platform.platformId, payload);
            await persistPlatformHistory(tx, user.userId, platform.platformId, { problems: [], submissions: payload.submissions });
            assert.equal(await tx.submission.count({ where: { userId: user.userId } }), 2);
            const storedProblem = await tx.problem.findUnique({ where: {
                platformId_platformProblemId: { platformId: platform.platformId, platformProblemId: '1' }
            } });
            const legacyTime = submittedAtMs + 1000;
            const legacy = await tx.submission.create({ data: { userId: user.userId, problemId: storedProblem.problemId,
                submittedAtMs: BigInt(legacyTime), verdict: 'Accepted', language: 'C++',
                deduplicationKey: `${user.userId}_${storedProblem.problemId}_${legacyTime}` } });
            await persistPlatformHistory(tx, user.userId, platform.platformId, { problems: [],
                submissions: [{ ...event(3), submittedAtMs: legacyTime }, { ...event(4), submittedAtMs: legacyTime }] });
            assert.equal(await tx.submission.count({ where: { userId: user.userId } }), 4);
            assert.equal((await tx.submission.findUnique({ where: { submissionId: legacy.submissionId } })).deduplicationKey,
                `native:${user.userId}:${platform.platformId}:3`);
            throw rollback;
        }, { isolationLevel: 'Serializable', timeout: 60000 });
    } catch (error) {
        if (error === rollback) console.info('IMPORT_DATABASE_OK: Cache, repeat imports, native IDs and legacy reconciliation verified; all synthetic rows rolled back.');
        else { console.error(JSON.stringify({ operation: 'verify_import_transaction', diagnostic: getErrorDiagnosticCode(error) })); process.exitCode = 1; }
    } finally { await prisma.$disconnect(); }
}
main();

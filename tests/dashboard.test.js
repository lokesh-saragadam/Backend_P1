jest.mock('../database/client', () => ({ prisma: {
    submission: { findMany: jest.fn(), findFirst: jest.fn() },
    problem: { findMany: jest.fn() }, userHandle: { count: jest.fn() }
} }));
const { prisma } = require('../database/client');
const { getAttemptedProblemCountsByTopic, getRecentActivity, getSubmissionCountsByMonth,
    getUniqueAttemptedProblemCount, calculateLongestStreak } = require('../services/dashboard.service');
beforeEach(() => jest.resetAllMocks());
test('two attempted problems with identical tags count twice, not once per tag collection', async () => {
    prisma.submission.findMany.mockResolvedValue([{ problemId: 1 }, { problemId: 2 }]);
    prisma.problem.findMany.mockResolvedValue([{ tags: ['array', 'math'] }, { tags: ['array', 'math'] }]);
    expect(await getAttemptedProblemCountsByTopic(1)).toEqual({ array: 2, math: 2 });
    expect(prisma.submission.findMany.mock.calls[0][0].distinct).toEqual(['problemId']);
});
test('recent events expose distinct submission IDs, verdicts, ratings and dates', async () => {
    const row = { problemId: 1, submittedAtMs: BigInt(Date.UTC(2026, 0, 1)), verdict: 'WRONG_ANSWER',
        language: 'Python', problem: { title: 'Example', problemRating: 800, platform: { name: 'Codeforces' } } };
    prisma.submission.findMany.mockResolvedValue([{ ...row, submissionId: 1 }, { ...row, submissionId: 2 }]);
    const result = await getRecentActivity(1);
    expect(result.map(event => event.submissionId)).toEqual([1, 2]);
    expect(result[0]).toMatchObject({ verdict: 'WRONG_ANSWER', problemRating: 800, submittedAt: new Date(Date.UTC(2026, 0, 1)) });
});
test('monthly series counts events in UTC while overview counts distinct attempted problems', async () => {
    prisma.submission.findMany.mockResolvedValue([{ submittedAtMs: BigInt(Date.UTC(2026, 0, 31, 23, 59)) },
        { submittedAtMs: BigInt(Date.UTC(2026, 1, 1)) }]);
    expect(await getSubmissionCountsByMonth(1)).toEqual({ 'January 2026': 1, 'February 2026': 1 });
    prisma.submission.findMany.mockResolvedValue([{ problemId: 1 }]);
    expect(await getUniqueAttemptedProblemCount(1)).toBe(1);
    expect(prisma.submission.findMany.mock.calls[1][0].distinct).toEqual(['problemId']);
    expect(calculateLongestStreak(['2026-02-01', '2026-01-31'])).toBe(2);
});

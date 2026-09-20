jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../database/client', () => ({ prisma: { problem: { findMany: jest.fn() }, $transaction: jest.fn() } }));
const axios = require('axios');
const { prisma } = require('../database/client');
const { collectLeetCodeImportData } = require('../services/leetcode.service');
const { normalizeSubmissionsAndProblems } = require('../services/codeforces.service');
const { persistPlatformHistory, persistUserPlatformHistory } = require('../database/platformImport.repository');
const time = Date.UTC(2026, 0, 1);
const event = (id, slug = 'two-sum') => ({ id: String(id), titleSlug: slug, timestamp: String(time / 1000), lang: 'python3' });
const metadata = (id, slug) => ({ questionId: String(id), titleSlug: slug, title: 'Same display title', difficulty: 'Easy', topicTags: [{ slug: 'array' }] });
function profile(events, rating = null) {
    axios.post.mockResolvedValueOnce({ data: { data: { userContestRanking: rating, recentAcSubmissionList: events } } });
}
beforeEach(() => {
    jest.resetAllMocks();
    prisma.problem.findMany.mockResolvedValue([]);
});
test('all cache hits still preserve all events, language, native IDs and millisecond timestamps', async () => {
    profile([event(11), event(12)]);
    prisma.problem.findMany.mockResolvedValue([{ problemId: 42, platformProblemId: '1', titleSlug: 'two-sum' }]);
    const result = await collectLeetCodeImportData('test');
    expect(result).toMatchObject({ contestRating: null, problems: [], submissions: [
        { platformSubmissionId: '11', platformProblemId: '1', language: 'python3', submittedAtMs: time },
        { platformSubmissionId: '12', platformProblemId: '1', language: 'python3', submittedAtMs: time }
    ] });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1].variables.limit).toBe(20);
    expect(prisma.problem.findMany.mock.calls[0][0].where.platform).toEqual({ name: 'Leetcode' });
});
test('mixed cache hits fetch only missing metadata and map by slug rather than duplicate display titles', async () => {
    profile([event(11), event(12, 'second-problem'), event(13, 'second-problem')], { rating: 1600.5 });
    prisma.problem.findMany.mockResolvedValue([{ problemId: 42, platformProblemId: '1', titleSlug: 'two-sum' }]);
    axios.post.mockResolvedValueOnce({ data: { data: { q0: metadata(2, 'second-problem') } } });
    const result = await collectLeetCodeImportData('test');
    expect(result.contestRating).toBe(1600);
    expect(result.problems).toHaveLength(1);
    expect(result.submissions.map(submission => submission.platformProblemId)).toEqual(['1', '2', '2']);
    expect(axios.post.mock.calls[1][1].variables).toEqual({ slug0: 'second-problem' });
});
test('twenty events on three problems produce three metadata records and twenty events', async () => {
    profile(Array.from({ length: 20 }, (_, index) => event(index + 1, ['one', 'two', 'three'][index % 3])));
    axios.post.mockResolvedValueOnce({ data: { data: { q0: metadata(1, 'one'), q1: metadata(2, 'two'), q2: metadata(3, 'three') } } });
    const result = await collectLeetCodeImportData('test');
    expect(result.problems).toHaveLength(3);
    expect(result.submissions).toHaveLength(20);
});
test.each([
    { data: { q0: null } },
    { data: { q0: metadata(1, 'wrong-slug') } },
    { errors: [{ message: 'PRIVATE_UPSTREAM_DETAIL' }], data: { q0: metadata(1, 'two-sum') } }
])('partial metadata responses fail explicitly rather than silently losing events', async response => {
    profile([event(1)]);
    axios.post.mockResolvedValueOnce({ data: response });
    await expect(collectLeetCodeImportData('test')).rejects.toMatchObject({ code: 'LEETCODE_DATA_UNAVAILABLE' });
});
test('missing language remains unknown and empty history needs no metadata query', async () => {
    profile([{ ...event(1), lang: null }]);
    prisma.problem.findMany.mockResolvedValue([{ platformProblemId: '1', titleSlug: 'two-sum' }]);
    expect((await collectLeetCodeImportData('test')).submissions[0].language).toBeNull();
    profile([]);
    expect(await collectLeetCodeImportData('test')).toEqual({ contestRating: null, problems: [], submissions: [] });
    expect(axios.post).toHaveBeenCalledTimes(2);
});
test('invalid timestamps fail before any cache queries', async () => {
    profile([{ ...event(1), timestamp: 'not-a-time' }]);
    await expect(collectLeetCodeImportData('test')).rejects.toMatchObject({ code: 'LEETCODE_DATA_UNAVAILABLE' });
    expect(prisma.problem.findMany).not.toHaveBeenCalled();
});

function memoryTransaction(seed = []) {
    const rows = seed.map(row => ({ ...row }));
    let nextId = 100;
    const tx = {
        problem: {
            upsert: jest.fn().mockResolvedValue({ problemId: 42 }),
            findMany: jest.fn().mockResolvedValue([{ problemId: 42, platformProblemId: '1' }])
        },
        submission: {
            findMany: jest.fn(async ({ where }) => rows.filter(row => row.userId === where.userId &&
                (where.OR[0].deduplicationKey.in.includes(row.deduplicationKey) ||
                 where.OR[1].platformSubmissionId.in.includes(row.platformSubmissionId)))),
            update: jest.fn(async ({ where, data }) => Object.assign(rows.find(row => row.submissionId === where.submissionId), data)),
            createMany: jest.fn(async ({ data }) => {
                for (const row of data) if (!rows.some(existing => existing.deduplicationKey === row.deduplicationKey)) {
                    rows.push({ submissionId: nextId++, ...row });
                }
            })
        }
    };
    return { tx, rows };
}
const normalizedEvent = id => ({ platformProblemId: '1', platformSubmissionId: String(id), submittedAtMs: time, verdict: 'Accepted', language: 'python3' });
test('cached problems record repeated attempts, retry idempotently, and remain independent for another user', async () => {
    const { tx, rows } = memoryTransaction();
    const payload = { problems: [], submissions: [normalizedEvent(11), normalizedEvent(12)] };
    await persistPlatformHistory(tx, 1, 8, payload);
    await persistPlatformHistory(tx, 1, 8, payload);
    await persistPlatformHistory(tx, 2, 8, payload);
    expect(rows).toHaveLength(4);
    expect(rows.filter(row => row.userId === 1)).toHaveLength(2);
    expect(tx.problem.upsert).not.toHaveBeenCalled();
    expect(tx.problem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platformId: 8, platformProblemId: { in: ['1'] } } }));
});
test('a legacy row is enriched, not duplicated; a second event in the same second remains distinct', async () => {
    const legacyKey = `1_42_${time}`;
    const { tx, rows } = memoryTransaction([{ submissionId: 5, userId: 1, problemId: 42,
        platformSubmissionId: null, deduplicationKey: legacyKey, submittedAtMs: BigInt(time), verdict: 'Accepted', language: 'C++' }]);
    const payload = { problems: [], submissions: [normalizedEvent(11), normalizedEvent(12)] };
    await persistPlatformHistory(tx, 1, 8, payload);
    await persistPlatformHistory(tx, 1, 8, payload);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ submissionId: 5, deduplicationKey: legacyKey, platformSubmissionId: '11', language: 'python3' });
    expect(rows.map(row => row.platformSubmissionId)).toEqual(['11', '12']);
});
test('duplicate events within a batch create one row', async () => {
    const { tx, rows } = memoryTransaction();
    await persistPlatformHistory(tx, 1, 8, { problems: [], submissions: [normalizedEvent(11), normalizedEvent(11)] });
    expect(rows).toHaveLength(1);
});
test('unknown problem mappings reject rather than skipping events', async () => {
    const { tx } = memoryTransaction();
    tx.problem.findMany.mockResolvedValue([]);
    await expect(persistPlatformHistory(tx, 1, 8, { problems: [], submissions: [normalizedEvent(1)] }))
        .rejects.toMatchObject({ code: 'UNRESOLVED_SUBMISSION' });
    expect(tx.submission.createMany).not.toHaveBeenCalled();
});
test('platform IDs come from database records and existing handles can sync again', async () => {
    const { tx } = memoryTransaction();
    tx.platform = { upsert: jest.fn(async ({ where }) => ({ platformId: where.name === 'Leetcode' ? 8 : 21 })) };
    tx.userHandle = { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() };
    prisma.$transaction.mockImplementation(callback => callback(tx));
    const payload = { contestRating: null, problems: [], submissions: [] };
    await persistUserPlatformHistory(1, { Leetcode: 'lc', Codeforces: 'cf' }, payload, payload);
    expect(tx.userHandle.upsert.mock.calls.map(([query]) => query.create.platformId)).toEqual([8, 21]);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
    tx.userHandle.findUnique.mockResolvedValue({ handle: 'different' });
    await expect(persistUserPlatformHistory(1, { Leetcode: 'lc', Codeforces: 'cf' }, payload, payload))
        .rejects.toMatchObject({ code: 'HANDLE_ALREADY_LINKED' });
});
test('Codeforces retains failed attempts and native IDs in the shared import contract', () => {
    const result = normalizeSubmissionsAndProblems([{ id: 123, creationTimeSeconds: time / 1000,
        verdict: 'WRONG_ANSWER', programmingLanguage: 'GNU C++17',
        problem: { contestId: 10, index: 'A', name: 'Example', tags: ['math'], rating: 800 } }]);
    expect(result.submissions[0]).toMatchObject({ platformSubmissionId: '123', platformProblemId: '10-A', verdict: 'WRONG_ANSWER', submittedAtMs: time });
    expect(result.problems[0].problemRating).toBe(800);
});

test('missing metadata is bulk inserted, cached metadata is untouched, and legacy catalog IDs are preserved', async () => {
    const { tx } = memoryTransaction();
    const problem = { platformProblemId: '1', title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', problemRating: null, tags: ['array'] };
    tx.problem.createMany = jest.fn();
    tx.problem.update = jest.fn();
    tx.problem.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ problemId: 42, ...problem }]);
    await persistPlatformHistory(tx, 1, 8, { problems: [problem], submissions: [normalizedEvent(1)] });
    expect(tx.problem.createMany).toHaveBeenCalledWith({ data: [{ platformId: 8, ...problem }], skipDuplicates: true });
    await persistPlatformHistory(tx, 1, 8, { problems: [problem], submissions: [] });
    expect(tx.problem.update).not.toHaveBeenCalled();
    tx.problem.findMany.mockResolvedValue([{ problemId: 42, ...problem, titleSlug: null }]);
    await persistPlatformHistory(tx, 1, 8, { problems: [problem], submissions: [] });
    expect(tx.problem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { problemId: 42 } }));
});
test('serialization failures are retried, other database failures propagate', async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' }).mockResolvedValueOnce('completed');
    expect(await persistUserPlatformHistory(1, {}, {}, {})).toBe('completed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    prisma.$transaction.mockRejectedValue({ code: 'P1001' });
    await expect(persistUserPlatformHistory(1, {}, {}, {})).rejects.toEqual({ code: 'P1001' });
});

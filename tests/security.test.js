process.env.JWT_SECRET = 'local-regression-test-secret-only';
process.env.CORS_ORIGINS = 'http://localhost:5173';

jest.mock('../database/client', () => ({
    prisma: {
        user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
        problem: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
        platform: { findUnique: jest.fn() },
        submission: { upsert: jest.fn(), findFirst: jest.fn() },
        $transaction: jest.fn()
    }
}));
jest.mock('../services/leetcode.service', () => ({ collectLeetCodeImportData: jest.fn() }));
jest.mock('../services/codeforces.service', () => ({ collectCodeforcesImportData: jest.fn() }));
jest.mock('../database/platformImport.repository', () => ({ persistUserPlatformHistory: jest.fn() }));
jest.mock('../services/dashboard.service', () => ({ getDashboardData: jest.fn() }));
jest.mock('bcrypt', () => ({
    hash: jest.fn(async password => 'hashed:' + password), compare: jest.fn()
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { prisma } = require('../database/client');
const { collectLeetCodeImportData } = require('../services/leetcode.service');
const { collectCodeforcesImportData } = require('../services/codeforces.service');
const { persistUserPlatformHistory } = require('../database/platformImport.repository');
const { getDashboardData } = require('../services/dashboard.service');
const bcrypt = require('bcrypt');
const app = require('../app');
const token = jwt.sign({ userId: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
const auth = { Authorization: 'Bearer ' + token };
const record = { platformProblemId: '1', status: 'Accepted', language: 'Python', submittedAtMs: Date.UTC(2026, 0, 1) };

let info, errorLog;
beforeAll(() => {
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => { info.mockRestore(); errorLog.mockRestore(); });
beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockReset().mockResolvedValue({ userId: 1, username: 'test', passwordHash: 'hash' });
    prisma.user.findFirst.mockReset().mockResolvedValue(null);
    prisma.user.create.mockReset().mockImplementation(async ({ data }) => ({ userId: 1, ...data }));
    prisma.problem.findMany.mockReset().mockResolvedValue([{ problemId: 10, platformProblemId: '1' }]);
    prisma.platform.findUnique.mockReset().mockResolvedValue({ platformId: 8 });
    prisma.$transaction.mockReset().mockImplementation(callback => callback(prisma));
    prisma.submission.upsert.mockReset().mockResolvedValue({});
    prisma.submission.findFirst.mockReset().mockResolvedValue(null);
    bcrypt.compare.mockReset().mockResolvedValue(false);
    getDashboardData.mockResolvedValue({ overview: { uniqueAttemptedProblems: 3 } });
    persistUserPlatformHistory.mockReset().mockResolvedValue(undefined);
    collectLeetCodeImportData.mockReset().mockResolvedValue({ problems: [], submissions: [] });
    collectCodeforcesImportData.mockReset().mockResolvedValue({ problems: [], submissions: [] });
});

test.each([
    ['get', '/api/dashboard/2', undefined],
    ['get', '/api/users/2', undefined],
    ['post', '/api/users/2', {}],
    ['post', '/api/Leetcode/2', {}],
    ['post', '/api/problems', { userId: 2 }],
    ['post', '/api/users/1', { userId: 2 }]
])('blocks cross-account access: %s %s', async (method, path, body) => {
    const response = await request(app)[method](path).set(auth).send(body);
    expect(response.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(persistUserPlatformHistory).not.toHaveBeenCalled();
    expect(getDashboardData).not.toHaveBeenCalled();
});

test('rejects absent, malformed, expired and deleted-account sessions', async () => {
    expect((await request(app).get('/api/dashboard/1')).status).toBe(401);
    expect((await request(app).get('/api/dashboard/1').set('Authorization', 'Basic ' + token)).status).toBe(401);
    const expired = jwt.sign({ userId: 1 }, process.env.JWT_SECRET, { expiresIn: -1 });
    expect((await request(app).get('/api/dashboard/1').set('Authorization', 'Bearer ' + expired)).status).toBe(401);
    prisma.user.findUnique.mockResolvedValue(null);
    expect((await request(app).get('/api/dashboard/1').set(auth)).status).toBe(401);
});

test('handles invalid IDs and the owning user correctly', async () => {
    expect((await request(app).get('/api/dashboard/nope').set(auth)).status).toBe(400);
    const response = await request(app).get('/api/dashboard/1').set(auth);
    expect(response.status).toBe(200);
    expect(getDashboardData).toHaveBeenCalledWith(1);
    expect((await request(app).get('/api/users/1').set(auth)).body).toEqual({ username: 'test' });
});

test('concurrent registrations retain their own username, email and password', async () => {
    prisma.user.findFirst.mockImplementation(() => new Promise(resolve => setImmediate(() => resolve(null))));
    const accounts = [
        { username: 'alpha', email: 'alpha@example.test', password: 'alpha-password' },
        { username: 'bravo', email: 'bravo@example.test', password: 'bravo-password' }
    ];
    const responses = await Promise.all(accounts.map(body => request(app).post('/api/register').send(body)));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    for (const account of accounts) {
        expect(prisma.user.create).toHaveBeenCalledWith({ data: { username: account.username, email: account.email, passwordHash: 'hashed:' + account.password } });
    }
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ username: 'alpha' }, { email: 'alpha@example.test' }] }, select: { username: true, email: true }
    });
});

test('registration handles duplicate conflicts and validates credentials', async () => {
    const account = { username: 'alpha', email: 'alpha@example.test', password: 'alpha-password' };
    prisma.user.findFirst.mockResolvedValue({ userId: 1 });
    expect((await request(app).post('/api/register').send(account)).status).toBe(409);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue({ code: 'P2002', meta: 'PRIVATE' });
    const conflict = await request(app).post('/api/register').send(account);
    expect(conflict.status).toBe(409);
    expect(JSON.stringify(conflict.body)).not.toContain('PRIVATE');
    expect((await request(app).post('/api/register').send({ ...account, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/register').send({ ...account, password: '界'.repeat(25) })).status).toBe(400);
});

test('wrong email and wrong password receive the same retry response', async () => {
    const credentials = { email: 'test@example.test', password: 'incorrect' };
    const wrongPassword = await request(app).post('/api/login').send(credentials);
    prisma.user.findUnique.mockResolvedValue(null);
    const wrongEmail = await request(app).post('/api/login').send(credentials);
    expect(wrongPassword.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    expect(wrongEmail.body.message).toBe(wrongPassword.body.message);
    expect(wrongEmail.body.message).toContain('try again');
    expect(wrongEmail.body.token).toBeUndefined();
});

test('successful login returns a valid signed session', async () => {
    bcrypt.compare.mockResolvedValue(true);
    const response = await request(app).post('/api/login').send({ email: 'test@example.test', password: 'valid-password' });
    expect(response.status).toBe(200);
    expect(jwt.verify(response.body.token, process.env.JWT_SECRET).userId).toBe(1);
});

test('rejects unlisted origins including preflight, and permits configured origin', async () => {
    expect((await request(app).options('/api/login').set('Origin', 'https://unlisted.test')
        .set('Access-Control-Request-Method', 'POST')).status).toBe(403);
    const blocked = await request(app).get('/api/users/1').set(auth).set('Origin', 'https://unlisted.test');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    const allowed = await request(app).options('/api/login').set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
});

test('does not serve public user data or raw errors, even in logs', async () => {
    expect((await request(app).get('/user_data.json')).status).toBe(404);
    expect((await request(app).get('/%75ser_data.json')).status).toBe(404);
    prisma.user.findUnique.mockRejectedValue(new Error('PRIVATE_DATABASE_CONNECTION_AND_PASSWORD'));
    const response = await request(app).get('/api/users/1?token=PRIVATE_QUERY').set(auth);
    expect(response.status).toBe(500);
    const output = JSON.stringify([response.body, info.mock.calls, errorLog.mock.calls]);
    expect(output).not.toContain('PRIVATE_');
    expect(output).not.toContain(token);
    expect(response.body.requestId).toBeTruthy();
});

test('invalid JSON and oversized bodies have safe errors', async () => {
    expect((await request(app).post('/api/login').set('Content-Type', 'application/json').send('{')).status).toBe(400);
    expect((await request(app).post('/api/login').send({ password: 'x'.repeat(1024 * 1024) })).status).toBe(413);
});

test('client import writes owner submissions without changing shared metadata', async () => {
    const response = await request(app).post('/api/Leetcode/1').set(auth).send({
        platform: 'Leetcode', submissions: [{ ...record, title: 'Injected title', tags: ['injected'], difficulty: 'Hard' }]
    });
    expect(response.status).toBe(200);
    expect(prisma.submission.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ userId: 1, problemId: 10, verdict: 'Accepted' })
    }));
    expect(JSON.stringify(prisma.submission.upsert.mock.calls, (_, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain('Injected');
    expect(response.body.result.submissionsProcessed).toBe(1);
});

test('unknown problems reject the complete batch without writes', async () => {
    const response = await request(app).post('/api/Leetcode/1').set(auth).send({
        platform: 'Leetcode', submissions: [record, { ...record, platformProblemId: 'unknown' }]
    });
    expect(response.status).toBe(422);
    expect(prisma.$transaction).not.toHaveBeenCalled();
});

test.each([
    {}, { platform: 'Leetcode', submissions: null },
    { platform: 'Leetcode', submissions: Array(501).fill(record) },
    { platform: 'Leetcode', submissions: [{ ...record, submittedAtMs: 1700000000 }] },
    { platform: 'Leetcode', submissions: [null] }
])('validates import payload before database writes: %j', async body => {
    expect((await request(app).post('/api/Leetcode/1').set(auth).send(body)).status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
});

test('onboarding uses session identity and propagates platform failure', async () => {
    const body = { platforms: { Leetcode: 'lc_handle', Codeforces: 'cf_handle' } };
    expect((await request(app).post('/api/users/1').set(auth).send(body)).status).toBe(200);
    expect(persistUserPlatformHistory).toHaveBeenCalledWith(1, body.platforms, expect.any(Object), expect.any(Object));
    collectLeetCodeImportData.mockResolvedValue(null);
    expect((await request(app).post('/api/users/1').set(auth).send(body)).status).toBe(502);
    expect(persistUserPlatformHistory).toHaveBeenCalledTimes(1);
});

test('problem and summary endpoints use Prisma native return shapes', async () => {
    prisma.problem.count.mockResolvedValue(2);
    prisma.problem.groupBy.mockResolvedValue([{ _count: { _all: 2 } }]);
    const summary = await request(app).get('/api/stats/summary').set(auth);
    expect(summary.status).toBe(200);
    expect(summary.body.totalcount).toBe(2);
    expect((await request(app).get('/api/problems').set(auth)).body).toEqual([{ problemId: 10, platformProblemId: '1' }]);
    expect((await request(app).get('/api/problems?limit=1000').set(auth)).status).toBe(400);
});

test('persistence failures propagate instead of claiming onboarding succeeded', async () => {
    const { persistUserPlatformHistory: persist } = jest.requireActual('../database/platformImport.repository');
    const failure = new Error('PRIVATE_PERSISTENCE_ERROR');
    prisma.platform.upsert = jest.fn().mockRejectedValue(failure);
    await expect(persist(1, { Leetcode: 'lc', Codeforces: 'cf' }, {}, {})).rejects.toBe(failure);
    prisma.platform.upsert.mockResolvedValue({ platformId: 1 });
    prisma.platform.findMany = jest.fn().mockResolvedValue([]);
    prisma.userHandle = { findUnique: jest.fn().mockRejectedValue(failure) };
    await expect(persist(1, { Leetcode: 'lc', Codeforces: 'cf' }, {}, {})).rejects.toBe(failure);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('PRIVATE_PERSISTENCE_ERROR');
});


test.each([
    [{ username: 'alpha', email: 'other@example.test' }, 'USERNAME_IN_USE', 'Username already exists'],
    [{ username: 'someone', email: 'alpha@example.test' }, 'EMAIL_IN_USE', 'Email is already in use']
])('registration identifies the conflicting field', async (existing, code, message) => {
    prisma.user.findFirst.mockResolvedValue(existing);
    const response = await request(app).post('/api/register').send({ username: 'alpha', email: 'alpha@example.test', password: 'valid-password' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe(code);
    expect(response.body.message).toContain(message);
    expect(prisma.user.create).not.toHaveBeenCalled();
});

test.each([['username', 'USERNAME_IN_USE'], ['email', 'EMAIL_IN_USE']])('concurrent unique conflict identifies %s', async (field, code) => {
    prisma.user.create.mockRejectedValue({ code: 'P2002', meta: { target: [field], details: 'PRIVATE' } });
    const response = await request(app).post('/api/register').send({ username: 'alpha', email: 'alpha@example.test', password: 'valid-password' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe(code);
    expect(JSON.stringify([response.body, errorLog.mock.calls])).not.toContain('PRIVATE');
});

test('conflict without constraint metadata is rechecked after a race', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ username: 'other', email: 'alpha@example.test' });
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    const response = await request(app).post('/api/register').send({ username: 'alpha', email: 'alpha@example.test', password: 'valid-password' });
    expect(response.body.code).toBe('EMAIL_IN_USE');
});

test.each([
    [{ code: 'P1001' }, 503, 'DATABASE_UNREACHABLE'],
    [{ code: 'P1000' }, 503, 'DATABASE_AUTH_FAILED'],
    [{ code: 'P2021' }, 500, 'DATABASE_TABLE_MISSING'],
    [{ name: 'PrismaClientValidationError' }, 500, 'DATABASE_QUERY_INVALID'],
    [{ name: 'PrismaClientInitializationError', message: "Can't reach database server: PRIVATE_HOST" }, 503, 'DATABASE_UNREACHABLE']
])('database failures provide safe operational diagnostics', async (failure, status, diagnostic) => {
    prisma.user.findUnique.mockRejectedValue({ message: 'PRIVATE_DB_PASSWORD', ...failure });
    const response = await request(app).post('/api/login').send({ email: 'test@example.test', password: 'test-password' });
    expect(response.status).toBe(status);
    const logged = errorLog.mock.calls.map(([line]) => JSON.parse(line)).find(item => item.event === 'request_failed');
    expect(logged).toMatchObject({ diagnostic, operation: 'login.lookup_user', requestId: response.body.requestId });
    expect(JSON.stringify([response.body, errorLog.mock.calls])).not.toContain('PRIVATE_');
});

test('legacy extension field names remain accepted', async () => {
    const response = await request(app).post('/api/Leetcode/1').set(auth).send({ platform: 'Leetcode',
        submissions: [{ problemcode: '1', status: 'Accepted', timestamp: Date.UTC(2026, 0, 1), language: 'Python' }] });
    expect(response.status).toBe(200);
    expect(prisma.submission.upsert).toHaveBeenCalledTimes(1);
});
test('legacy owner field cannot bypass authorization after renaming', async () => {
    const response = await request(app).post('/api/users/1').set(auth).send({ userid: 2 });
    expect(response.status).toBe(403);
});
test('client import does not duplicate or overwrite an existing trusted native event', async () => {
    prisma.submission.findFirst.mockResolvedValue({ submissionId: 12 });
    const response = await request(app).post('/api/Leetcode/1').set(auth).send({ platform: 'Leetcode', submissions: [record] });
    expect(response.status).toBe(200);
    expect(prisma.submission.upsert).not.toHaveBeenCalled();
});

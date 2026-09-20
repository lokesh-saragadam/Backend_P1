process.env.JWT_SECRET = 'operations-test-secret-not-for-production';
process.env.ADMIN_USER_IDS = '1';
process.env.CORS_ORIGINS = 'https://frontend.example.test';
process.env.ADMIN_ORIGIN = 'https://backend.example.test';
jest.mock('../database/client', () => ({ prisma: { user: { findUnique: jest.fn() } } }));
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { prisma } = require('../database/client');
const { createLogStore, logStore } = require('../utils/logStore');
const logger = require('../utils/logger');
const app = require('../app');
const token = userId => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
let infoSpy, errorSpy;
beforeAll(() => { infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {}); errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { infoSpy.mockRestore(); errorSpy.mockRestore(); });
beforeEach(() => { process.env.ADMIN_USER_IDS = '1'; prisma.user.findUnique.mockResolvedValue({ userId: 1 }); });
test('ring buffer keeps the newest events in order and returns isolated copies', () => {
    const store = createLogStore(3);
    for (let i = 0; i < 5; i++) store.append({ event: 'operation', time: new Date().toISOString() });
    const snapshot = store.snapshot();
    expect(snapshot.events.map(event => event.sequence)).toEqual([3, 4, 5]);
    expect(snapshot.discardedEvents).toBe(2);
    snapshot.events[0].event = 'changed';
    expect(store.snapshot().events[0].event).toBe('operation');
});
test('summary counts completed requests, not their paired error events', () => {
    const store = createLogStore();
    store.append({ event: 'request_failed', status: 503, requestId: 'same' });
    store.append({ event: 'http_request', status: 503, requestId: 'same', durationMs: 100 });
    store.append({ event: 'http_request', status: 200, durationMs: 20 });
    store.append({ event: 'http_request', status: 401, durationMs: 30 });
    expect(store.snapshot().summary).toEqual({ requests: 3, serverFailures: 1, clientErrors: 1, averageDurationMs: 50 });
});
test('anonymous, ordinary, expired and deleted-account sessions cannot read logs', async () => {
    expect((await request(app).get('/api/admin/logs')).status).toBe(401);
    prisma.user.findUnique.mockResolvedValue({ userId: 2 });
    const ordinary = await request(app).get('/api/admin/logs').auth(token(2), { type: 'bearer' });
    expect(ordinary.status).toBe(403);
    expect(ordinary.body.events).toBeUndefined();
    const expired = jwt.sign({ userId: 1 }, process.env.JWT_SECRET, { expiresIn: -1 });
    expect((await request(app).get('/api/admin/logs').auth(expired, { type: 'bearer' })).status).toBe(401);
    prisma.user.findUnique.mockResolvedValue(null);
    expect((await request(app).get('/api/admin/logs').auth(token(1), { type: 'bearer' })).status).toBe(401);
});
test('admin reads are not cached and do not create successful polling feedback', async () => {
    const before = logStore.snapshot().totalEvents;
    const response = await request(app).get('/api/admin/logs').auth(token(1), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ capacity: 1000, instanceId: expect.any(String), events: expect.any(Array) });
    expect(logStore.snapshot().totalEvents).toBe(before);
});
test('empty allowlist denies even an authenticated account', async () => {
    process.env.ADMIN_USER_IDS = '';
    expect((await request(app).get('/api/admin/logs').auth(token(1), { type: 'bearer' })).status).toBe(403);
});
test('logger strips sensitive context before both storage and output', () => {
    logger.error('request_failed', { requestId: 'safe-id', code: 'SAFE_CODE', password: 'PRIVATE_PASSWORD',
        token: 'PRIVATE_TOKEN', body: { email: 'PRIVATE_EMAIL' }, stack: 'PRIVATE_STACK', message: 'PRIVATE_MESSAGE' });
    const event = logStore.snapshot().events.at(-1);
    expect(event).toMatchObject({ requestId: 'safe-id', code: 'SAFE_CODE' });
    expect(JSON.stringify(event)).not.toContain('PRIVATE_');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('PRIVATE_');
});
test('dashboard assets expose no log data; legacy routes redirect and raw JSON remains private', async () => {
    const response = await request(app).get('/admin/logs');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Request history');
    expect(response.text).not.toContain('safe-id');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect((await request(app).get('/operations-assets/dashboard.js')).status).toBe(200);
    expect((await request(app).get('/login.html')).headers.location).toBe('/admin/logs');
    expect((await request(app).get('/user_data.json')).status).toBe(404);
});
test('backend origin is allowed explicitly while an unknown origin is rejected', async () => {
    expect((await request(app).options('/api/login').set('Origin', 'https://backend.example.test')
        .set('Access-Control-Request-Method', 'POST')).status).toBe(204);
    expect((await request(app).options('/api/login').set('Origin', 'https://unknown.example.test')
        .set('Access-Control-Request-Method', 'POST')).status).toBe(403);
});

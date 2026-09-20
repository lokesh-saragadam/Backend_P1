require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { randomUUID } = require('crypto');
const log = require('./utils/logger');
const HttpError = require('./utils/httpError');
const { getErrorDiagnosticCode } = require('./utils/errorDiagnostics');
const { router } = require('./routes/api.routes');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const requestStartedAtMs = Date.now();
    res.on('finish', () => log.info('http_request', {
        requestId: req.requestId, method: req.method,
        // Route templates only: never log raw URLs, query strings or user IDs.
        route: req.route?.path || 'unmatched',
        status: res.statusCode, durationMs: Date.now() - requestStartedAtMs
    }));
    next();
});
const allowedOrigins = (process.env.CORS_ORIGINS ||
    'http://localhost:5173,chrome-extension://ekefiaamkelcgkfpmpohnbahldohakga')
    .split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new HttpError(403, 'This origin is not allowed.', 'ORIGIN_FORBIDDEN'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Request-Id']
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
// Serve only deliberate public assets. Never expose dataset JSON files.
const publicRoot = path.join(__dirname, 'public');
app.use('/css', express.static(path.join(publicRoot, 'css'), { dotfiles: 'deny', index: false }));
app.use('/images', express.static(path.join(publicRoot, 'images'), { dotfiles: 'deny', index: false }));
for (const page of ['index', 'login', 'register', 'about']) {
    app.get(page === 'index' ? ['/', '/index.html'] : '/' + page + '.html',
        (req, res) => res.sendFile(path.join(publicRoot, page + '.html')));
}
app.use('/api', router);
app.use((req, res) => res.status(404).json({ success: false, message: 'Page or endpoint not found.' }));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = 500;
    let message = 'Something went wrong. Please try again.';
    let code = 'INTERNAL_ERROR';
    if (error instanceof HttpError) {
        ({ status, message, code } = error);
    } else if (error.type === 'entity.too.large') {
        status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'The request is too large. Please send a smaller batch.';
    } else if (error.type === 'entity.parse.failed') {
        status = 400; code = 'INVALID_JSON'; message = 'The request contains invalid JSON.';
    } else if (error.code === 'P2002') {
        status = 409; code = 'CONFLICT'; message = 'That record already exists.';
    } else if (getErrorDiagnosticCode(error).startsWith('DATABASE_') &&
        !['DATABASE_QUERY_INVALID', 'DATABASE_TABLE_MISSING', 'DATABASE_COLUMN_MISSING', 'DATABASE_QUERY_FAILED'].includes(getErrorDiagnosticCode(error))) {
        status = 503; code = 'DATABASE_UNAVAILABLE';
        message = 'The account service cannot connect to its database right now. Please try again later.';
    }
    log.error('request_failed', {
        requestId: req.requestId, method: req.method, route: req.route?.path || 'unmatched',
        operation: req.operation || 'request', status, code,
        diagnostic: error instanceof HttpError ? code : getErrorDiagnosticCode(error)
    });
    res.status(status).json({ success: false, message, code, requestId: req.requestId });
});

if (require.main === module) {
    if (!process.env.JWT_SECRET) {
        log.error('startup_failed', { code: 'JWT_SECRET_MISSING' });
        process.exitCode = 1;
    } else {
        const port = Number(process.env.PORT) || 3000;
        app.listen(port, () => log.info('app_started', { port }));
    }
}
module.exports = app;

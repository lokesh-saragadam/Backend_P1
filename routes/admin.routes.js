const express = require('express');
const { authenticate } = require('../middleware/protectRoutes');
const { logStore } = require('../utils/logStore');
const HttpError = require('../utils/httpError');
const adminRouter = express.Router();

// Authentication proves identity. This separate check grants administrator access.
// An empty/malformed allowlist grants nobody access; clients cannot set their role.
function requireAdmin(req, res, next) {
    const allowedIds = (process.env.ADMIN_USER_IDS || '').split(',')
        .map(value => value.trim()).filter(value => /^[1-9]\d*$/.test(value));
    if (!allowedIds.includes(String(req.user.userId))) {
        return next(new HttpError(403, 'This account does not have operations access.', 'ADMIN_REQUIRED'));
    }
    next();
}
adminRouter.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.vary('Authorization');
    // Successful monitoring reads should not fill their own history buffer.
    req.isOperationsRequest = true;
    next();
});
adminRouter.use(authenticate, requireAdmin);
adminRouter.get('/logs', (req, res) => res.json(logStore.snapshot()));
module.exports = { adminRouter, requireAdmin };

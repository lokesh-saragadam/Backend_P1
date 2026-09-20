const jwt = require('jsonwebtoken');
const { prisma } = require('../database/client');
const HttpError = require('../utils/httpError');

async function authenticate(req, res, next) {
    const bearerMatch = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
    if (!bearerMatch) return next(new HttpError(401, 'Please sign in to continue.', 'AUTH_REQUIRED'));
    let tokenClaims;
    try {
        tokenClaims = jwt.verify(bearerMatch[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
        if (!Number.isSafeInteger(tokenClaims.userId) || tokenClaims.userId <= 0) throw new Error();
    } catch {
        return next(new HttpError(401, 'Your session has expired or is invalid. Please sign in again.', 'INVALID_SESSION'));
    }
    try {
        const user = await prisma.user.findUnique({
            where: { userId: tokenClaims.userId }, select: { userId: true }
        });
        if (!user) return next(new HttpError(401, 'Please sign in again.', 'INVALID_SESSION'));
        req.user = { userId: user.userId };
        next();
    } catch (error) {
        next(error);
    }
}

function requireOwner(req, res, next) {
    const requestedUserIds = [req.params.id, req.body?.userId, req.body?.userid].filter(value => value !== undefined);
    for (const target of requestedUserIds) {
        if (!['string', 'number'].includes(typeof target) || !/^[1-9]\d*$/.test(String(target)) ||
            !Number.isSafeInteger(Number(target))) {
            return next(new HttpError(400, 'A valid user ID is required.', 'INVALID_USER_ID'));
        }
        if (Number(target) !== req.user.userId) {
            return next(new HttpError(403, 'You can only access your own account.', 'FORBIDDEN'));
        }
    }
    next();
}
module.exports = { authenticate, requireOwner };

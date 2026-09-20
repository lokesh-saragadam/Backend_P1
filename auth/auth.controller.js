const { prisma } = require('../database/client');
const bcrypt = require('bcrypt');
const asyncHandler = require('express-async-handler');
const jwt = require('jsonwebtoken');
const HttpError = require('../utils/httpError');

function validateCredentials(body, registering = false) {
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = body?.password;
    if (!email || email.length > 225 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, 'Enter a valid email address. Please try again.', 'INVALID_EMAIL');
    }
    if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
        throw new HttpError(400, 'Enter a password of no more than 72 bytes. Please try again.', 'INVALID_PASSWORD');
    }
    // Keep exact email case compatible with existing accounts; no data migration.
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    if (registering && (!username || username.length > 100)) {
        throw new HttpError(400, 'Enter a username between 1 and 100 characters. Please try again.', 'INVALID_USERNAME');
    }
    if (registering && password.length < 8) {
        throw new HttpError(400, 'Use a password with at least 8 characters. Please try again.', 'INVALID_PASSWORD');
    }
    return { email, password, username };
}
function createSessionResponse(user) {
    return {
        userId: user.userId,
        token: jwt.sign({ userId: user.userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' })
    };
}
const registerUser = asyncHandler(async (req, res) => {
    req.operation = 'register.validate';
    const { username, email, password } = validateCredentials(req.body, true);
    const createRegistrationConflict = (existingAccount, conflictingFields = []) => {
        if (existingAccount?.username === username || conflictingFields.includes('username')) {
            return new HttpError(409, 'Username already exists. Choose another username and try again.', 'USERNAME_IN_USE');
        }
        if (existingAccount?.email === email || conflictingFields.includes('email')) {
            return new HttpError(409, 'Email is already in use. Sign in or use another email address.', 'EMAIL_IN_USE');
        }
        return new HttpError(409, 'That username or email is already registered. Please try again or sign in.', 'ACCOUNT_EXISTS');
    };
    const conflictQuery = { where: { OR: [{ username }, { email }] }, select: { username: true, email: true } };
    req.operation = 'register.check_conflict';
    const existingAccount = await prisma.user.findFirst(conflictQuery);
    if (existingAccount) throw createRegistrationConflict(existingAccount);
    req.operation = 'register.hash_password';
    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
        req.operation = 'register.create_user';
        user = await prisma.user.create({ data: { username, email, passwordHash } });
    } catch (error) {
        if (error.code === 'P2002') {
            const conflictingFields = Array.isArray(error.meta?.target) ? error.meta.target : [];
            if (conflictingFields.includes('username') || conflictingFields.includes('email')) throw createRegistrationConflict(null, conflictingFields);
            // A concurrent registration may win between the lookup and create.
            req.operation = 'register.recheck_conflict';
            throw createRegistrationConflict(await prisma.user.findFirst(conflictQuery));
        }
        throw error;
    }
    req.operation = 'register.issue_session';
    res.status(201).json({ message: 'Registration successful.', ...createSessionResponse(user) });
});
const loginUser = asyncHandler(async (req, res) => {
    req.operation = 'login.validate';
    const { email, password } = validateCredentials(req.body);
    req.operation = 'login.lookup_user';
    const user = await prisma.user.findUnique({ where: { email } });
    req.operation = 'login.verify_password';
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
        throw new HttpError(401, 'Incorrect email or password. Please try again.', 'INVALID_CREDENTIALS');
    }
    req.operation = 'login.issue_session';
    res.json(createSessionResponse(user));
});
module.exports = { registerUser, loginUser };

const { prisma } = require('../database/client');
const asyncHandler = require('express-async-handler');
const HttpError = require('../utils/httpError');

const getCurrentUser = asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { userId: req.user.userId }, select: { username: true }
    });
    if (!user) throw new HttpError(404, 'Account not found.', 'USER_NOT_FOUND');
    res.status(200).json({ username: user.username });
});
module.exports = { getCurrentUser };

const { prisma } = require('../database/client');
const asyncHandler = require('express-async-handler');
const { getDashboardData } = require('../services/dashboard.service');
const HttpError = require('../utils/httpError');

const getDashboard = asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { userId: req.user.userId }, select: { username: true }
    });
    if (!user) throw new HttpError(404, 'Account not found.', 'USER_NOT_FOUND');
    const result = await getDashboardData(req.user.userId);
    res.json({ username: user.username, dashboardData: result });
});
module.exports = { getDashboard };

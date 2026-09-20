const { prisma } = require('../database/client');
const asyncHandler = require('express-async-handler');

// Catalog summary; dashboard submission calculations are intentionally unchanged.
const getCatalogSummary = asyncHandler(async (req, res) => {
    const [totalcount, difficultyCounts, platformCounts] = await Promise.all([
        prisma.problem.count(),
        prisma.problem.groupBy({ by: ['difficulty'], _count: { _all: true } }),
        prisma.problem.groupBy({ by: ['platformId'], _count: { _all: true } })
    ]);
    res.json({ totalcount, difficultyCounts, platformCounts });
});
module.exports = { getCatalogSummary };

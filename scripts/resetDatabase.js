const { prisma } = require('../database/client');
const logger = require('../utils/logger');
// Explicit manual development utility. Importing this module never resets data.
async function resetDatabase() {
    await prisma.$executeRaw`TRUNCATE TABLE "Submission", "UserHandle", "Problem", "User", "Platform" RESTART IDENTITY CASCADE`;
    logger.info('database_reset', { operation: 'resetDatabase' });
}
module.exports = { resetDatabase };

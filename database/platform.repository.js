const { prisma } = require('./client');
async function loadPlatforms() {
    const platforms = await prisma.platform.findMany();
    return Object.fromEntries(platforms.map(platform => [platform.name, platform.platformId]));
}
module.exports = { loadPlatforms };

const { pool , prisma } = require('./db')
const log = require("../utils/logger");
const platformMap = {};

async function loadPlatforms() {
    log("load_func.js","loadPlatforms","Request received");

    const result = await prisma.Platform.findMany();

    result.forEach(row => {
        platformMap[row.name] = row.platformid;
    });

    log("load_func.js","loadPlatforms","Request resolved");

    return platformMap;
}

module.exports = {loadPlatforms};


// DROP SCHEMA public CASCADE;
 // CREATE SCHEMA public;
const log = require("../utils/logger");
const { pool , prisma } = require('../database/db');
async function reset_Database() {
    log("createTables.js", "reset_Database", "Request received");

    try {
        await prisma.$executeRawUnsafe(`
            TRUNCATE TABLE
                "Submission",
                "UserHandle",
                "Problem",
                "User",
                "Platform"
            RESTART IDENTITY CASCADE;
        `);

        log("createTables.js", "reset_Database", "Request resolved");
    } catch (err) {
        console.error(err);
    }
}




module.exports = {reset_Database}
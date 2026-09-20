// Read-only diagnostic: never prints connection strings or account records.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const { getErrorDiagnosticCode } = require('../utils/errorDiagnostics');

async function main() {
    let prisma;
    let stage = 'configuration';
    try {
        if (!process.env.DATABASE_URL) {
            console.error('DATABASE_CONFIGURATION_ERROR: DATABASE_URL is missing.');
            process.exitCode = 1;
            return;
        }
        stage = 'initialize_client';
        ({ prisma } = require('../database/client'));
        stage = 'read_user_table';
        await prisma.user.findFirst({ select: { userId: true } });
        console.info('DATABASE_OK: Connection and User table read succeeded. No records were modified.');
    } catch (error) {
        console.error(JSON.stringify({ check: 'database', stage, diagnostic: getErrorDiagnosticCode(error) }));
        process.exitCode = 1;
    } finally {
        if (prisma) await prisma.$disconnect().catch(() => {
            console.error('DATABASE_DISCONNECT_FAILED');
            process.exitCode = 1;
        });
    }
}
main();

// Classify internally, then return only fixed labels. Never log the source message.
function getErrorDiagnosticCode(error) {
    const code = error?.code || error?.errorCode;
    const codes = {
        P1000: 'DATABASE_AUTH_FAILED', P1001: 'DATABASE_UNREACHABLE',
        P1002: 'DATABASE_TIMEOUT', P1003: 'DATABASE_NOT_FOUND',
        P1008: 'DATABASE_TIMEOUT', P1010: 'DATABASE_ACCESS_DENIED',
        P1011: 'DATABASE_TLS_ERROR', P1012: 'DATABASE_CONFIGURATION_ERROR',
        P1013: 'DATABASE_URL_INVALID', P1017: 'DATABASE_CONNECTION_CLOSED',
        P2021: 'DATABASE_TABLE_MISSING', P2022: 'DATABASE_COLUMN_MISSING',
        P2024: 'DATABASE_POOL_TIMEOUT', P2002: 'UNIQUE_CONSTRAINT_CONFLICT'
    };
    if (Object.hasOwn(codes, code)) return codes[code];
    if (error?.name === 'PrismaClientInitializationError') {
        // Some Prisma initialization failures have no code.
        const message = String(error.message || '');
        if (/Can't reach database server/i.test(message)) return 'DATABASE_UNREACHABLE';
        if (/Tenant or user not found/i.test(message)) return 'DATABASE_POOLER_CONFIGURATION_ERROR';
        if (/Authentication failed/i.test(message)) return 'DATABASE_AUTH_FAILED';
        if (/Environment variable not found/i.test(message)) return 'DATABASE_CONFIGURATION_ERROR';
        if (/TLS|certificate/i.test(message)) return 'DATABASE_TLS_ERROR';
        return 'DATABASE_INITIALIZATION_FAILED';
    }
    const names = {
        PrismaClientValidationError: 'DATABASE_QUERY_INVALID',
        PrismaClientKnownRequestError: 'DATABASE_QUERY_FAILED',
        PrismaClientUnknownRequestError: 'DATABASE_QUERY_FAILED',
        PrismaClientRustPanicError: 'DATABASE_ENGINE_FAILED',
        TypeError: 'APPLICATION_TYPE_ERROR', ReferenceError: 'APPLICATION_REFERENCE_ERROR'
    };
    return Object.hasOwn(names, error?.name) ? names[error.name] : 'UNEXPECTED_SERVER_ERROR';
}
module.exports = { getErrorDiagnosticCode };

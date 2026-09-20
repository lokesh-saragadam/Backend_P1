const { logStore } = require('./logStore');
// Only operational allowedLogFields are allowed. Never pass bodies, tokens, user records,
// upstream responses, raw error messages or stacks to the output sink.
const allowedLogFields = new Set(['requestId', 'method', 'route', 'status', 'durationMs', 'code', 'port', 'diagnostic', 'operation']);
function emit(level, event, context = {}) {
    const entry = { time: new Date().toISOString(), level, event };
    for (const [key, value] of Object.entries(context)) {
        if (allowedLogFields.has(key) && (typeof value === 'number' || typeof value === 'string')) {
            entry[key] = typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').slice(0, 160) : value;
        }
    }
    // Store only the same allowlisted data sent to the console, never raw context.
    // Observability must not turn a healthy application request into a failure.
    try { logStore.append(entry); } catch { /* Console logging remains available. */ }
    (level === 'error' ? console.error : console.info)(JSON.stringify(entry));
}
// Compatibility for existing lifecycle calls: discard message/data arguments.
function log(file, operation) {
    if (process.env.LOG_LEVEL === 'debug') emit('debug', 'operation', { route: file + ':' + operation });
}
log.info = (event, context) => emit('info', event, context);
log.warn = (event, context) => emit('warn', event, context);
log.error = (event, context) => emit('error', event, context);
module.exports = log;

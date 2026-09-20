const { randomUUID } = require('node:crypto');

/** A ring buffer overwrites its oldest slot instead of growing without a limit. */
function createLogStore(capacity = 1000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid log capacity');
    const slots = new Array(capacity);
    const instanceId = randomUUID();
    const startedAt = new Date().toISOString();
    let sequence = 0;
    return {
        append(event) {
            sequence += 1;
            // Copy and freeze: a caller cannot change an event after it was recorded.
            slots[(sequence - 1) % capacity] = Object.freeze({ ...event, sequence });
        },
        snapshot() {
            const events = [];
            const firstSequence = Math.max(1, sequence - capacity + 1);
            for (let id = firstSequence; id <= sequence; id++) {
                events.push({ ...slots[(id - 1) % capacity] });
            }
            // Count completed requests, not error lines: a failure can have both.
            const requests = events.filter(event => event.event === 'http_request');
            const durations = requests.map(event => event.durationMs).filter(Number.isFinite);
            return {
                instanceId, startedAt, capacity, totalEvents: sequence,
                discardedEvents: Math.max(0, sequence - capacity), events,
                summary: {
                    requests: requests.length,
                    serverFailures: requests.filter(event => event.status >= 500).length,
                    clientErrors: requests.filter(event => event.status >= 400 && event.status < 500).length,
                    averageDurationMs: durations.length
                        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null
                }
            };
        }
    };
}
const logStore = createLogStore();
module.exports = { createLogStore, logStore };

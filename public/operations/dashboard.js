/* Operations dashboard: plain browser JavaScript, no build step required.
 * Read this file in four parts: state, safe rendering, fetching, event handlers.
 */
'use strict';
const element = id => document.getElementById(id);
const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 5000;
const state = {
    token: null, snapshot: null, view: 'requests', page: 1,
    paused: false, timer: null, controller: null, generation: 0, selected: null
};
const typeDescriptions = {
    http_request: ['HTTP request', 'A completed browser or API request. Duration measures server-side request handling.'],
    request_failed: ['Request failure', 'The error handler rejected or could not complete this request. Check the operation and diagnostic.'],
    app_started: ['Application started', 'The backend process started listening for requests.'],
    startup_failed: ['Startup failure', 'The backend could not start normally.'],
    operation: ['Operation', 'A debug lifecycle event from an application service.'],
    operation_failed: ['Operation failure', 'An application operation reported a failure.']
};

// Always render log values as text. innerHTML would let log content become markup.
function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = String(text);
    if (className) result.className = className;
    return result;
}
function formatDate(time) {
    return new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function describeType(eventName) { return typeDescriptions[eventName]?.[0] || eventName; }
function notice(message = '') {
    element('notice').textContent = message;
    element('notice').hidden = !message;
}
function connection(label, kind) {
    element('connection').textContent = label;
    element('connection').dataset.state = kind;
}
function filters() {
    return Object.fromEntries(['search', 'route-filter', 'level', 'status', 'method', 'type', 'since', 'sort']
        .map(id => [id, element(id).value.trim()]));
}
function filteredEvents() {
    const options = filters();
    const cutoff = options.since === '0' ? 0 : Date.now() - Number(options.since) * 60000;
    // Join searchable context by request ID so a diagnostic on request_failed
    // also finds the matching completed request in the Request history tab.
    const allEvents = state.snapshot?.events || [];
    const requestContext = new Map();
    for (const event of allEvents) {
        if (event.requestId) requestContext.set(event.requestId,
            (requestContext.get(event.requestId) || '') + ' ' + [event.code, event.diagnostic, event.operation].join(' '));
    }
    return allEvents.filter(event => {
        if (state.view === 'requests' && event.event !== 'http_request') return false;
        if (options.level && event.level !== options.level) return false;
        if (options.status && Math.floor(event.status / 100) !== Number(options.status)) return false;
        if (options.method && event.method !== options.method) return false;
        if (options.type && event.event !== options.type) return false;
        if (Date.parse(event.time) < cutoff) return false;
        if (options['route-filter'] && !(event.route || '').toLowerCase().includes(options['route-filter'].toLowerCase())) return false;
        const searchable = [event.requestId, event.route, event.event, event.code, event.diagnostic, event.operation, event.method, event.status, requestContext.get(event.requestId)].join(' ').toLowerCase();
        return !options.search || searchable.includes(options.search.toLowerCase());
    }).sort((a, b) => {
        const chronological = Date.parse(a.time) - Date.parse(b.time) || a.sequence - b.sequence;
        return options.sort === 'asc' ? chronological : -chronological;
    });
}
function showDetails(event) {
    state.selected = event;
    element('details-title').textContent = describeType(event.event);
    element('details-description').textContent = typeDescriptions[event.event]?.[1] || 'A structured operational event emitted by the backend.';
    const related = event.requestId
        ? state.snapshot.events.filter(item => item.requestId === event.requestId) : [event];
    const failure = related.find(item => item.event === 'request_failed');
    const fields = {
        'Time (local)': formatDate(event.time), 'Time (UTC)': event.time, Level: event.level,
        Type: event.event, Status: event.status ?? 'Not an HTTP response', Method: event.method ?? '—',
        Route: event.route ?? '—', 'Request ID': event.requestId ?? 'Not tied to a request',
        Duration: event.durationMs === undefined ? '—' : `${event.durationMs} ms`,
        Operation: event.operation ?? failure?.operation ?? '—', Code: event.code ?? failure?.code ?? '—', Diagnostic: event.diagnostic ?? failure?.diagnostic ?? '—',
        'Event sequence': event.sequence
    };
    const detailFields = element('detail-fields');
    detailFields.replaceChildren();
    for (const [label, value] of Object.entries(fields)) detailFields.append(node('dt', label), node('dd', value));

    element('related-events').replaceChildren(...related.map(item => {
        const row = node('li');
        row.append(node('strong', `${formatDate(item.time)} · ${describeType(item.event)}`));
        row.append(node('div', [item.method, item.route, item.status, item.diagnostic || item.code, item.operation].filter(value => value !== undefined).join(' · ')));
        return row;
    }));
    element('details').showModal();
}
function renderHistory() {
    const events = filteredEvents();
    const pages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    element('result-count').textContent = `${events.length} matching ${state.view === 'requests' ? 'requests' : 'events'}`;
    const rows = events.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).map(event => {
        const row = node('tr');
        row.append(node('td', formatDate(event.time)));
        const level = node('td');
        level.append(node('span', event.level, `badge ${['info', 'warn', 'error', 'debug'].includes(event.level) ? event.level : ''}`));
        row.append(level);
        const status = node('td');
        status.append(node('span', event.status ?? '—', `badge ${event.status >= 500 ? 'error' : event.status >= 400 ? 'warn' : event.status >= 200 && event.status < 300 ? 'success' : ''}`));
        row.append(status);
        const route = node('td');
        route.append(node('span', event.method || '—', 'method'), node('span', event.route || 'Application', 'route'));
        row.append(route);
        const request = node('td');
        const button = node('button', event.requestId ? `${event.requestId.slice(0, 8)}…` : 'View event', 'request-link');
        button.title = event.requestId || 'Open event details';
        button.setAttribute('aria-label', `Inspect ${event.requestId || event.event}`);
        button.addEventListener('click', () => showDetails(event));
        request.append(button);
        row.append(request);
        const type = node('td', describeType(event.event), 'event-name');
        type.append(node('small', event.event));
        row.append(type, node('td', event.durationMs === undefined ? '—' : `${event.durationMs} ms`, 'duration'));
        return row;
    });
    element('history-rows').replaceChildren(...rows);
    element('empty-state').hidden = events.length !== 0;
    element('page-info').textContent = `Page ${state.page} of ${pages} · ${PAGE_SIZE} per page`;
    element('previous').disabled = state.page <= 1;
    element('next').disabled = state.page >= pages;
}
function renderSnapshot(snapshot) {
    const previousInstance = state.snapshot?.instanceId;
    state.snapshot = snapshot;
    if (previousInstance && previousInstance !== snapshot.instanceId) {
        state.page = 1;
        notice('The backend instance changed. You are viewing its separate recent history; older events may no longer be available.');
        element('details').close();
    } else notice();
    element('instance').textContent = `Instance ${snapshot.instanceId.slice(0, 8)}`;
    element('started').textContent = `Started ${formatDate(snapshot.startedAt)}`;
    element('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    element('metric-requests').textContent = snapshot.summary.requests;
    element('metric-failures').textContent = snapshot.summary.serverFailures;
    element('metric-client').textContent = snapshot.summary.clientErrors;
    element('metric-duration').textContent = snapshot.summary.averageDurationMs === null ? '—' : `${snapshot.summary.averageDurationMs} ms`;
    element('retention').textContent = `${snapshot.events.length} of ${snapshot.capacity} retained events · ${snapshot.discardedEvents} older events discarded · Summary ignores filters`;
    const selectedType = element('type').value;
    const types = [...new Set(snapshot.events.map(event => event.event))].sort();
    if (selectedType && !types.includes(selectedType)) types.push(selectedType);
    element('type').replaceChildren(new Option('All event types', ''), ...types.map(type => new Option(describeType(type), type)));
    element('type').value = selectedType;
    renderHistory();
}

// One in-flight request and one timer prevent slow networks from piling up polls.
function scheduleRefresh() {
    clearTimeout(state.timer);
    if (state.token && !state.paused && !document.hidden) state.timer = setTimeout(refresh, POLL_INTERVAL_MS);
}
async function refresh() {
    if (!state.token || state.controller) return;
    const generation = state.generation;
    const controller = new AbortController();
    state.controller = controller;
    element('refresh').disabled = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch('/api/admin/logs', {
            headers: { Authorization: `Bearer ${state.token}` }, cache: 'no-store', signal: controller.signal
        });
        const snapshot = await response.json();
        if (generation !== state.generation) return;
        if (response.status === 401 || response.status === 403) {
            signOut(snapshot.message || 'Please sign in again.');
            return;
        }
        if (!response.ok) throw new Error(snapshot.message || 'Could not read operational history.');
        renderSnapshot(snapshot);
        connection(state.paused ? 'Updates paused' : 'Live · every 5s', state.paused ? 'paused' : 'live');
    } catch (error) {
        if (generation !== state.generation) return;
        connection('Disconnected', 'error');
        notice(error.name === 'AbortError' ? 'The refresh timed out. Showing the last received snapshot.' : 'Could not refresh. Showing the last received snapshot; retry or check your connection.');
    } finally {
        clearTimeout(timeout);
        if (generation === state.generation) {
            state.controller = null;
            element('refresh').disabled = false;
            scheduleRefresh();
        }
    }
}
function signOut(message = '') {
    // Invalidate pending responses before clearing state so they cannot redraw private data.
    state.generation += 1;
    clearTimeout(state.timer);
    state.controller?.abort();
    state.controller = null;
    state.token = null;
    state.snapshot = null;
    state.selected = null;
    state.page = 1;
    state.paused = false;
    element('pause').textContent = 'Pause updates';
    element('details').close();
    element('detail-fields').replaceChildren();
    element('related-events').replaceChildren();
    element('history-rows').replaceChildren();
    element('filters').reset();
    element('type').replaceChildren(new Option('All event types', ''));
    for (const id of ['metric-requests', 'metric-failures', 'metric-client', 'metric-duration', 'instance', 'started', 'updated', 'retention', 'result-count']) element(id).textContent = '—';
    notice();
    element('console').hidden = true;
    element('signin').hidden = false;
    element('signin-error').textContent = message;
    element('password').value = '';
    element('email').focus();
}

element('signin-form').addEventListener('submit', async event => {
    event.preventDefault();
    element('signin-button').disabled = true;
    element('signin-error').textContent = '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ email: element('email').value.trim(), password: element('password').value })
        });
        const session = await response.json();
        if (!response.ok) throw new Error(session.message || 'Unable to sign in.');
        state.token = session.token;
        state.generation += 1;
        element('password').value = '';
        // Do not reveal the dashboard until the separate admin authorization check succeeds.
        await refresh();
        if (state.token && state.snapshot) {
            element('signin').hidden = true;
            element('console').hidden = false;
            element('refresh').focus();
        } else if (state.token) signOut('Could not load operations. Please try again.');
    } catch (error) {
        element('signin-error').textContent = error.name === 'AbortError' ? 'Sign-in timed out. Please try again.' : error.message;
    } finally {
        clearTimeout(timeout);
        element('signin-button').disabled = false;
    }
});
element('signout').addEventListener('click', () => signOut());
element('refresh').addEventListener('click', refresh);
element('pause').addEventListener('click', () => {
    state.paused = !state.paused;
    element('pause').textContent = state.paused ? 'Resume updates' : 'Pause updates';
    connection(state.paused ? 'Updates paused' : 'Live · every 5s', state.paused ? 'paused' : 'live');
    if (!state.paused) refresh();
    scheduleRefresh();
});
element('filters').addEventListener('submit', event => event.preventDefault());
element('filters').addEventListener('input', () => { state.page = 1; renderHistory(); });
element('reset-filters').addEventListener('click', () => { element('filters').reset(); state.page = 1; renderHistory(); });
function selectTab(view) {
    state.view = view;
    state.page = 1;
    for (const name of ['requests', 'events']) {
        element(`${name}-tab`).setAttribute('aria-selected', String(name === view));
        element(`${name}-tab`).tabIndex = name === view ? 0 : -1;
    }
    element('history-content').setAttribute('aria-labelledby', `${view}-tab`);
    renderHistory();
}
for (const view of ['requests', 'events']) {
    element(`${view}-tab`).addEventListener('click', () => selectTab(view));
    element(`${view}-tab`).addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'requests' : event.key === 'End' ? 'events' : view === 'requests' ? 'events' : 'requests';
        selectTab(next);
        element(`${next}-tab`).focus();
    });
}
element('previous').addEventListener('click', () => { state.page -= 1; renderHistory(); });
element('next').addEventListener('click', () => { state.page += 1; renderHistory(); });
element('close-details').addEventListener('click', () => element('details').close());
document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(state.timer);
    else if (!state.paused) refresh();
});

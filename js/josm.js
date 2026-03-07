/**
 * josm.js — JOSM Remote Control connection management.
 *
 * Protocol probe order: HTTPS on port 8112 first, HTTP on port 8111 as fallback.
 * Once a working base is found it is remembered for the session.
 * If HTTPS fails but HTTP succeeds, HTTPS is never retried for the session.
 *
 * Public API:
 *   josmFetch(path, opts?)      — send any Remote Control request
 *   detectJosmVersion()         — fetch /version, cache on success, allow retry on error
 */

const JOSM_BASES = [
    'https://127.0.0.1:8112',
    'http://127.0.0.1:8111',
];

// Known working base URL, or null (undiscovered).
// Never permanently set to a "failed" sentinel — lets detectJosmVersion() re-probe
// when the user starts JOSM after page load (see comment in detectJosmVersion).
let _base = null;

// Cached version result — only set on success; null means "retry allowed".
let _version = null;

/**
 * Probe all base URLs in priority order and return the first successful response.
 * Throws if all bases fail (connection refused, TLS error, etc.).
 */
async function _probe(path, opts) {
    for (const base of JOSM_BASES) {
        try {
            const r = await fetch(base + path, opts);
            _base = base;
            return r;
        } catch { /* try next */ }
    }
    throw new Error('JOSM not reachable');
}

/**
 * Send a request to JOSM Remote Control.
 *
 * Uses the known-good base if already discovered, falling back to a fresh probe
 * if the known base stops responding (e.g. JOSM was restarted).
 *
 * For action endpoints (add_node etc.) use { mode: 'no-cors' } — the response body
 * is not needed and this avoids any preflight CORS issue.
 * For the /version endpoint a regular fetch is required to read the JSON body.
 */
export async function josmFetch(path, opts = {}) {
    if (_base) {
        try {
            return await fetch(_base + path, opts);
        } catch {
            // Known base failed — JOSM may have been restarted on a different port.
            _base = null;
        }
    }
    return _probe(path, opts);
}

/**
 * Detect JOSM version via GET /version.
 *
 * Always re-probes the base URL so that a freshly started JOSM is discovered even
 * if a previous attempt failed. The version result is cached only on success so
 * that the next call returns immediately; errors are not cached, allowing retry.
 *
 * Never throws — always returns a result object:
 *   { status: 'ok',        version, protocolMajor, protocolMinor }
 *   { status: 'forbidden' }   JOSM running but site not yet authorized
 *   { status: 'error'     }   connection refused, network failure, etc.
 */
export async function detectJosmVersion() {
    if (_version) return _version;

    // Reset the preferred base so we always reprobe when retrying after an error.
    // This lets the user start JOSM after page load and have it detected on the
    // next Settings tab open without a page reload.
    _base = null;

    try {
        const r = await _probe('/version');
        if (r.status === 403) return { status: 'forbidden' };
        if (!r.ok)            return { status: 'error' };
        const data = await r.json();
        _version = {
            status: 'ok',
            version: data.version,
            protocolMajor: data.protocolversion?.major,
            protocolMinor: data.protocolversion?.minor,
            port: new URL(_base).port,
        };
        return _version;
    } catch {
        return { status: 'error' };   // not cached — retry on next call
    }
}

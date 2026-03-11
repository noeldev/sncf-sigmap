/**
 * josm.js — JOSM Remote Control connection management.
 *
 * Protocol probe order: HTTPS on port 8112 first, HTTP on port 8111 as fallback.
 * Once a working base is found it is remembered for the session.
 *
 * Public API:
 *   josmFetch(path, opts?)     — low-level: send any Remote Control request
 *   josmAddNode(latlng, tags)  — add a node with OSM tags at the given position
 *   josmGetVersion()           — probe /version, cache on success, retry on error
 */

const JOSM_BASES = [
    'https://127.0.0.1:8112',
    'http://127.0.0.1:8111',
];

// Known-good base URL for this session; null means undiscovered.
// Never permanently set to a failure sentinel so josmGetVersion() can re-probe
// when the user starts JOSM after page load.
let _base    = null;
let _version = null;   // cached only on success; null means "retry allowed"

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
 * Uses the known-good base if already discovered, re-probing if it stops responding.
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
 * Add an OSM node at the given position via JOSM Remote Control.
 * @param {[number, number]} latlng - [latitude, longitude]
 * @param {Map<string, string>} tags - OSM key/value pairs
 * Throws on network failure or non-OK HTTP status.
 */
export async function josmAddNode(latlng, tags) {
    const addtags = [...tags.entries()]
        .map(([k, v]) => encodeURIComponent(`${k}=${v}`))
        .join(encodeURIComponent('|'));
    const r = await josmFetch(`/add_node?lat=${latlng[0]}&lon=${latlng[1]}&addtags=${addtags}`);
    if (!r.ok) throw new Error(`JOSM returned HTTP ${r.status}`);
    return r;
}

/**
 * Detect JOSM version via GET /version.
 *
 * Always re-probes the base URL so a freshly started JOSM is discovered even
 * after a previous failure. The version result is cached only on success;
 * errors are not cached, allowing transparent retry.
 *
 * Never throws — always returns a result object:
 *   { status: 'ok',        version, protocolMajor, protocolMinor, port }
 *   { status: 'forbidden' }   JOSM running but site not yet authorised
 *   { status: 'error'     }   connection refused, network failure, etc.
 */
export async function josmGetVersion() {
    if (_version) return _version;

    // Reset preferred base so we always re-probe when retrying after an error.
    _base = null;

    try {
        const r = await _probe('/version');
        if (r.status === 403) return { status: 'forbidden' };
        if (!r.ok)            return { status: 'error' };
        const data = await r.json();
        _version = {
            status:        'ok',
            version:       data.version,
            protocolMajor: data.protocolversion?.major,
            protocolMinor: data.protocolversion?.minor,
            port:          new URL(_base).port,
        };
        return _version;
    } catch {
        return { status: 'error' };   // not cached — retry on next call
    }
}

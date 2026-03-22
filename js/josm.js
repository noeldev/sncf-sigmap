/**
 * josm.js — JOSM Remote Control connection management.
 *
 * JOSM Remote Control listens exclusively on HTTP port 8111 (localhost).
 * The port is hardcoded by JOSM and not configurable; HTTPS (port 8112) is
 * not available. HTTP requests to 127.0.0.1 from an HTTPS page are permitted
 * by browsers via the loopback origin exception (W3C Secure Contexts spec).
 *
 * Public API:
 *   josmFetch(path, opts?)     — low-level: send any Remote Control request
 *   josmAddNode(latlng, tags)  — add a node with OSM tags at the given position
 *   josmGetVersion()           — probe /version, cache on success, retry on error
 */

const JOSM_BASE = 'http://127.0.0.1:8111';

let _version = null;   // cached only on success; null means "retry allowed"

/**
 * Send a request to JOSM Remote Control.
 * Throws on network failure (JOSM not running / connection refused).
 */
export async function josmFetch(path, opts = {}) {
    return fetch(JOSM_BASE + path, opts);
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
 * The version result is cached only on success; errors are not cached,
 * allowing transparent retry when JOSM is started after page load.
 *
 * Never throws — always returns a result object:
 *   { status: 'ok',        version, protocolMajor, protocolMinor, port }
 *   { status: 'forbidden' }   JOSM running but site not yet authorised
 *   { status: 'error'     }   connection refused, network failure, etc.
 */
export async function josmGetVersion() {
    if (_version) return _version;

    try {
        const r = await josmFetch('/version');
        if (r.status === 403) return { status: 'forbidden' };
        if (!r.ok) return { status: 'error' };
        const data = await r.json();
        _version = {
            status: 'ok',
            version: data.version,
            protocolMajor: data.protocolversion?.major,
            protocolMinor: data.protocolversion?.minor,
            port: new URL(JOSM_BASE).port,
        };
        return _version;
    } catch {
        return { status: 'error' };   // not cached — retry on next call
    }
}

/**
 * prefs.js — Persistent user preferences.
 *
 * All keys are stored directly in localStorage. Since localStorage is
 * isolated per origin, no prefix is needed — keys are short and readable.
 *
 * Public API:
 *   getAutoTagsTab()         — true → popup opens on OSM Tags tab by default
 *   setAutoTagsTab(bool)
 *   getSkipJosmConfirm()     — true → skip JOSM confirmation when signal is in OSM
 *   setSkipJosmConfirm(bool)
 *   getControlsCollapsed()   — true → map controls toolbar is collapsed
 *   setControlsCollapsed(bool)
 *   getRememberPosition()    — true → restore last map position on startup
 *   setRememberPosition(bool)
 *   getLastPosition()        — { lat, lng, zoom } | null
 *   setLastPosition(lat, lng, zoom)
 *   getLastBasemap()         — last selected basemap key | null
 *   setLastBasemap(key)
 *   onPrefsChange(fn)        — register a listener called after any preference changes
 */


// ---- Namespaced localStorage wrapper ----

class Storage {
    get(key, defaultVal = null) {
        try {
            const v = localStorage.getItem(key);
            return v === null ? defaultVal : v;
        } catch {
            return defaultVal;
        }
    }

    set(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch { }
    }

    getJson(key, defaultVal = null) {
        try {
            const v = localStorage.getItem(key);
            return v === null ? defaultVal : JSON.parse(v);
        } catch {
            return defaultVal;
        }
    }

    setJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch { }
    }
}

const _s = new Storage();
const _listeners = [];

function _getBool(key, def) {
    const v = _s.get(key);
    return v === null ? def : v === 'true';
}

function _setBool(key, v) {
    _s.set(key, v);
    _listeners.forEach(fn => fn());
}


// ---- Public API ----

/** When true, clicking a signal marker opens the OSM Tags tab directly. */
export function getAutoTagsTab() {
    return _getBool('auto-tags-tab', false);
}
export function setAutoTagsTab(v) {
    _setBool('auto-tags-tab', v);
}

/** When true, the JOSM export confirmation is suppressed even when the
 *  signal is already known to exist in OpenStreetMap. */
export function getSkipJosmConfirm() {
    return _getBool('skip-josm-confirm', false);
}
export function setSkipJosmConfirm(v) {
    _setBool('skip-josm-confirm', v);
}

/** When true, the map controls toolbar is collapsed to hamburger + chevron only. */
export function getControlsCollapsed() {
    return _getBool('map-controls-collapsed', false);
}
export function setControlsCollapsed(v) {
    _setBool('map-controls-collapsed', v);
}

/** When true, the last map position and zoom level are restored on startup. */
export function getRememberPosition() {
    return _getBool('remember-position', false);
}
export function setRememberPosition(v) {
    _setBool('remember-position', v);
}

/**
 * Return the last saved map position, or null if none is stored.
 * @returns {{ lat: number, lng: number, zoom: number } | null}
 */
export function getLastPosition() {
    return _s.getJson('last-position', null);
}

/**
 * Persist the current map center and zoom level.
 * @param {number} lat
 * @param {number} lng
 * @param {number} zoom
 */
export function setLastPosition(lat, lng, zoom) {
    _s.setJson('last-position', { lat, lng, zoom });
}

/** Register a callback invoked whenever any boolean preference changes. */
/**
 * Return the last selected basemap key, or null if none is stored.
 * @returns {string|null}
 */
export function getLastBasemap() {
    return _s.get('last-basemap', null);
}

/**
 * Persist the selected basemap key.
 * @param {string} key
 */
export function setLastBasemap(key) {
    _s.set('last-basemap', key);
}

export function onPrefsChange(fn) {
    _listeners.push(fn);
}

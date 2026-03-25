/**
 * map.js — Leaflet initialisation and basemap tile layers.
 *
 * Responsibilities (intentionally narrow):
 *   - Create and export the Leaflet map instance.
 *   - Manage basemap tile layers and their selector buttons.
 *
 * Map toolbar button wiring (zoom, geolocation, fullscreen, sidebar toggle)
 * is handled by map-controls.js.
 * Status bar updates (zoom level, signal count, etc.) are handled by statusbar.js.
 *
 * Position persistence (save/restore) is also owned here since it requires
 * direct access to the map instance.
 *
 * refreshBasemapLabels() is exported so sidebar.js can trigger a label update
 * when the UI language changes, without exposing any internal basemap state.
 */

import { MAP_BBOX, MAP_STARTUP_ZOOM, DEFAULT_BASEMAP, OVERVIEW_MAX_ZOOM } from './config.js';
import { t } from './translation.js';
import {
    getRememberPosition, getLastPosition, setLastPosition,
    getLastBasemap, setLastBasemap
} from './prefs.js';

export let map;

// Private basemap key constants — single source of truth for key strings.
const BASEMAP_JAWG = 'jawg-transport';
const BASEMAP_OSM = 'osm';
const BASEMAP_SATELLITE = 'satellite';


const BASEMAPS = {
    [BASEMAP_JAWG]: {
        labelKey: 'basemap.jawg',
        thumb: 'assets/png/jawg-transport-thumb.png',
        url: 'https://tile.jawg.io/jawg-transports/{z}/{x}/{y}{r}.png?access-token={jawg_api_key}',
        opts: {
            attribution: '© <a href="https://jawg.io">Jawg Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            maxZoom: 22,
        },
    },
    [BASEMAP_OSM]: {
        labelKey: 'basemap.osm',
        thumb: 'assets/png/osm-thumb.png',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        opts: {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            maxZoom: 20,
        },
    },
    [BASEMAP_SATELLITE]: {
        labelKey: 'basemap.satellite',
        thumb: 'assets/png/satellite-thumb.png',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        opts: {
            attribution: '© Esri, Maxar, Earthstar Geographics',
            maxZoom: 20,
        },
    },
};

const _tileLayers = {};
let _current = null;

export async function initMap(containerId) {
    const jawgKey = await _loadJawgKey();
    _current = _resolveInitialBasemap(jawgKey);
    _createMapInstance(containerId);
    _createTileLayers(jawgKey);
    _tileLayers[_current].addTo(map);
    _buildBasemapButtons();
    return map;
}

/** Attempt to load the Jawg API key from the git-ignored config.local.js. */
async function _loadJawgKey() {
    try {
        const secret = await import('./config.local.js');
        return (secret.JAWG_API_KEY || '').trim();
    } catch {
        /* config.local.js absent — fall back to OSM */
        return '';
    }
}

/**
 * Determine the initial basemap key.
 * Restores the last saved basemap when valid; falls back to the configured
 * default (Jawg when a key is available, OSM otherwise).
 * Saved Jawg is ignored when no API key is available.
 */
function _resolveInitialBasemap(jawgKey) {
    const fallback = jawgKey ? DEFAULT_BASEMAP : BASEMAP_OSM;
    const saved = getLastBasemap();
    return (saved && (saved !== BASEMAP_JAWG || jawgKey)) ? saved : fallback;
}

/** Create and store the Leaflet map instance. */
function _createMapInstance(containerId) {
    map = L.map(containerId, {
        zoomControl: false,
        maxZoom: BASEMAPS[_current].opts.maxZoom,
        preferCanvas: true,
    });
    restoreLastPosition();
}

/** Instantiate all tile layers, injecting the Jawg API key where needed. */
function _createTileLayers(jawgKey) {
    Object.entries(BASEMAPS).forEach(([key, def]) => {
        const opts = key === BASEMAP_JAWG
            ? { ...def.opts, jawg_api_key: jawgKey }
            : def.opts;
        _tileLayers[key] = L.tileLayer(def.url, opts);
    });
}

/* ===== Position persistence ===== */

/**
 * Restore the last saved map position, or fall back to the default France extent.
 * Called once from initMap() — must run after the map instance exists.
 */
export function restoreLastPosition() {
    if (getRememberPosition()) {
        const pos = getLastPosition();
        if (pos?.lat != null && pos?.lng != null && pos?.zoom != null) {
            map.setView([+pos.lat, +pos.lng], +pos.zoom, { animate: false });
            return;
        }
    }
    map.fitBounds(MAP_BBOX, { maxZoom: MAP_STARTUP_ZOOM });
}

/**
 * Save the current map center and zoom level to persistent storage.
 * No-op when the 'remember position' preference is disabled.
 */
export function saveLastPosition() {
    if (!getRememberPosition()) return;
    const c = map.getCenter();
    setLastPosition(c.lat, c.lng, map.getZoom());
}


/* ===== Map event wiring ===== */

/**
 * Wire Leaflet map events for zoom-threshold detection and position saving.
 * Accepts a callback invoked after each move/zoom with the crossed-threshold flag.
 * Debounced so rapid pan/zoom sequences produce a single call.
 *
 * @param {function(boolean): void} onMove  Called with crossedThreshold after each event
 * @param {number}                  ms      Debounce delay in ms (default 150)
 */
export function initMapEvents(onMove, ms = 150) {
    let _lastZoom = map.getZoom();
    let _timer;
    map.on('moveend zoomend', () => {
        clearTimeout(_timer);
        _timer = setTimeout(() => {
            const z = map.getZoom();
            const crossedThreshold = (_lastZoom < OVERVIEW_MAX_ZOOM) !== (z < OVERVIEW_MAX_ZOOM);
            _lastZoom = z;
            saveLastPosition();
            onMove(crossedThreshold);
        }, ms);
    });
}


/* ===== Basemap selector buttons ===== */

function _buildBasemapButtons() {
    const list = document.getElementById('basemap-list');
    if (!list) return;
    list.replaceChildren();
    const tpl = document.getElementById('tpl-basemap-btn');
    Object.entries(BASEMAPS).forEach(([key, def]) => {
        list.appendChild(_makeBasemapBtn(key, def, tpl));
    });
}

/** Clone and configure one basemap selector button from the template. */
function _makeBasemapBtn(key, def, tpl) {
    const btn = tpl.content.cloneNode(true).querySelector('.basemap-btn');
    btn.classList.toggle('active', key === _current);
    btn.dataset.map = key;
    const thumb = btn.querySelector('.basemap-thumb');
    thumb.src = def.thumb;
    thumb.onerror = function () { this.style.display = 'none'; };
    btn.querySelector('.basemap-label').textContent = t(def.labelKey);
    btn.addEventListener('click', () => {
        _setBasemap(key);
        // Close the floating basemap panel after selection.
        document.getElementById('basemap-panel')?.classList.add('is-hidden');
        document.getElementById('btn-basemap')?.classList.remove('active');
    });
    return btn;
}

/**
 * Rebuild basemap selector buttons with updated translated labels.
 * Called by sidebar.js whenever the UI language changes.
 */
export function refreshBasemapLabels() {
    _buildBasemapButtons();
}

/* ===== Private helpers ===== */

function _setBasemap(key) {
    if (!_tileLayers[key] || key === _current) return;
    map.removeLayer(_tileLayers[_current]);
    _tileLayers[key].addTo(map);
    _current = key;
    setLastBasemap(key);
    document.querySelectorAll('.basemap-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.map === key)
    );
}

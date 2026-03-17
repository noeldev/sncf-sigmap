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
 * refreshBasemapLabels() is exported so sidebar.js can trigger a label update
 * when the UI language changes, without exposing any internal basemap state.
 */

import { MAP_BBOX, MAP_STARTUP_ZOOM, DEFAULT_BASEMAP } from './config.js';
import { t } from './i18n.js';

export let map;

const BASEMAPS = {
    'jawg-transport': {
        labelKey: 'basemap.jawg',
        thumb: 'assets/png/jawg-transport-thumb.png',
        url: 'https://tile.jawg.io/jawg-transports/{z}/{x}/{y}{r}.png?access-token={jawg_api_key}',
        opts: {
            attribution: '© <a href="https://jawg.io">Jawg Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            maxZoom: 22,
        },
    },
    'osm': {
        labelKey: 'basemap.osm',
        thumb: 'assets/png/osm-thumb.png',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        opts: {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            maxZoom: 20,
        },
    },
    'satellite': {
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
    let jawgKey = '';
    try {
        const secret = await import('./config.local.js');
        jawgKey = (secret.JAWG_API_KEY || '').trim();
    } catch { /* config.local.js absent — fall back to OSM */ }

    _current = jawgKey ? DEFAULT_BASEMAP : 'osm';

    map = L.map(containerId, {
        zoomControl: false,
        maxZoom: BASEMAPS[_current].opts.maxZoom,
        preferCanvas: true,
    }).fitBounds(MAP_BBOX, { maxZoom: MAP_STARTUP_ZOOM });

    Object.entries(BASEMAPS).forEach(([key, def]) => {
        const opts = key === 'jawg-transport'
            ? { ...def.opts, jawg_api_key: jawgKey }
            : def.opts;
        _tileLayers[key] = L.tileLayer(def.url, opts);
    });

    _tileLayers[_current].addTo(map);
    _buildBasemapButtons();
    return map;
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
    btn.addEventListener('click', () => _setBasemap(key));
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
    document.querySelectorAll('.basemap-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.map === key)
    );
}

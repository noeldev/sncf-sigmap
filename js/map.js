/**
 * map.js — Leaflet initialisation, basemap tile layers, map controls.
 *
 * Responsibilities (intentionally narrow):
 *   - Create and export the Leaflet map instance.
 *   - Manage basemap tile layers and their selector buttons.
 *   - Wire map-level controls: zoom, geolocation, fullscreen, sidebar toggle.
 *
 * Legend, language picker, tab handlers, JOSM detection panel, and
 * applyTranslations() are all orchestrated by app.js after initMap() returns.
 *
 * refreshBasemapLabels() is exported so app.js can trigger a label update
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
        const secret = await import('./config.secret.js');
        jawgKey = (secret.JAWG_API_KEY || '').trim();
    } catch { /* config.secret.js absent — fall back to OSM */ }

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
    _buildControls();
    return map;
}

/* ===== Basemap selector buttons ===== */

function _buildBasemapButtons() {
    const list = document.getElementById('basemap-list');
    if (!list) return;
    list.replaceChildren();
    const tpl = document.getElementById('tpl-basemap-btn');
    Object.entries(BASEMAPS).forEach(([key, def]) => {
        const btn = tpl.content.cloneNode(true).querySelector('.basemap-btn');
        btn.classList.toggle('active', key === _current);
        btn.dataset.map = key;
        btn.querySelector('.basemap-thumb').src = def.thumb;
        btn.querySelector('.basemap-thumb').onerror = function () { this.style.display = 'none'; };
        btn.querySelector('.basemap-label').textContent = t(def.labelKey);
        btn.addEventListener('click', () => _setBasemap(key));
        list.appendChild(btn);
    });
}

/**
 * Rebuild basemap selector buttons with updated translated labels.
 * Called by app.js whenever the UI language changes.
 */
export function refreshBasemapLabels() {
    _buildBasemapButtons();
}

/* ===== Map controls ===== */

function _buildControls() {
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => map.zoomIn());
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => map.zoomOut());
    document.getElementById('btn-geolocate')?.addEventListener('click', _geolocate);
    document.getElementById('btn-fullscreen')?.addEventListener('click', _toggleFullscreen);
    document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('sidebar-closed');
        setTimeout(() => map.invalidateSize(), 210);
    });
    document.addEventListener('fullscreenchange', () =>
        document.getElementById('btn-fullscreen')?.classList.toggle('active', !!document.fullscreenElement)
    );
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

function _geolocate() {
    if (!navigator.geolocation) { alert('Geolocation not available.'); return; }
    const btn = document.getElementById('btn-geolocate');
    btn?.classList.add('active');
    navigator.geolocation.getCurrentPosition(
        pos => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            L.circle([lat, lng], { radius: accuracy, color: '#2589c7', fillOpacity: .1, weight: 1 }).addTo(map);
            L.circleMarker([lat, lng], {
                radius: 7, color: '#fff', fillColor: '#2589c7', fillOpacity: 1, weight: 2,
            }).addTo(map).bindPopup(`±${Math.round(accuracy)} m`);
            map.setView([lat, lng], Math.min(Math.max(map.getZoom(), 14), 17), { animate: false });
            btn?.classList.remove('active');
        },
        err => { btn?.classList.remove('active'); alert('Location error: ' + err.message); },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function _toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
    } else {
        document.getElementById('app')?.requestFullscreen().catch(() => { });
    }
}

export function updateZoomStatus(zoom) {
    const el = document.getElementById('st-zoom');
    if (el) el.textContent = zoom;
}

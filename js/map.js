/**
 * map.js — Leaflet initialisation, basemaps, controls, legend, language picker.
 *
 * The Jawg API key is loaded inside initMap() via a dynamic import of
 * config.secret.js (git-ignored). If that file is absent or the key is empty
 */

import { MAP_BBOX, MAP_STARTUP_ZOOM, DEFAULT_BASEMAP } from './config.js';
import { LANGS, getLang, setLang, applyTranslations, t } from './i18n.js';
import { CATEGORY_INFO } from './signal-mapping.js';
import { detectJosmVersion } from './josm.js';

export let map;

// Basemap definitions. {jawg_api_key} is substituted in initMap() after the
// key is loaded from config.secret.js — consistent with Leaflet's own {z}/{x}/{y} convention.
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
    } catch { /* config.secret.js absent — OSM fallback */ }

    _current = jawgKey ? DEFAULT_BASEMAP : 'osm';

    let maxZoom = BASEMAPS[_current].opts.maxZoom;
    map = L.map(containerId, { zoomControl: false, maxZoom: maxZoom, preferCanvas: true })
        .fitBounds(MAP_BBOX, { maxZoom: MAP_STARTUP_ZOOM });

    // Substitute {jawg_api_key} via Leaflet's native placeholder mechanism.
    Object.entries(BASEMAPS).forEach(([key, def]) => {
        const opts = key === 'jawg-transport'
            ? { ...def.opts, jawg_api_key: jawgKey }
            : def.opts;
        _tileLayers[key] = L.tileLayer(def.url, opts);
    });

    _tileLayers[_current].addTo(map);

    _buildLayerButtons();
    _buildLegend();
    _buildLangPicker();
    _buildControls();
    applyTranslations();
    return map;
}

function _buildLayerButtons() {
    const list = document.getElementById('basemap-list');
    if (!list) return;
    list.innerHTML = '';
    Object.entries(BASEMAPS).forEach(([key, def]) => {
        const btn = document.createElement('button');
        btn.className = `layer-btn${key === _current ? ' active' : ''}`;
        btn.dataset.map = key;
        // Map thumbnail image (cropped PNG) with rounded corners
        btn.innerHTML = `
      <img src="${def.thumb}" width="36" height="36" alt=""
           class="layer-thumb" onerror="this.style.display='none'">
      <span>${t(def.labelKey)}</span>`;
        btn.addEventListener('click', () => _setBasemap(key));
        list.appendChild(btn);
    });
}

// Legend order derived from CATEGORY_INFO key order
function _buildLegend() {
    const body = document.getElementById('legend-body');
    if (!body) return;
    body.innerHTML = '';
    Object.keys(CATEGORY_INFO).forEach(cat => {
        const color = CATEGORY_INFO[cat] || CATEGORY_INFO.unknown;
        const row = document.createElement('div');
        row.className = 'panel-row';
        row.innerHTML = `<span class="legend-dot" style="background:${color}"></span>
                     <span data-i18n="cat.${cat}">${t('cat.' + cat)}</span>`;
        body.appendChild(row);
    });
}

function _buildLangPicker() {
    const dropdown = document.getElementById('lang-dropdown');
    const btn = document.getElementById('lang-select-btn');
    if (!dropdown || !btn) return;

    const _updateBtn = () => {
        const lang = getLang();
        const def = LANGS.find(l => l.code === lang) || LANGS[0];
        const flag = document.getElementById('lang-flag');
        const lbl = document.getElementById('lang-label');
        if (flag) {
            // SVG flag as <img>
            flag.innerHTML = `<img src="assets/svg/flag-${def.code}.svg"
                             alt="${def.label}" class="flag-img">`;
        }
        if (lbl) lbl.textContent = def.label;
        dropdown.querySelectorAll('.lang-option')
            .forEach(o => o.classList.toggle('active', o.dataset.lang === lang));
    };

    dropdown.innerHTML = '';
    LANGS.forEach(lang => {
        const li = document.createElement('li');
        li.className = `lang-option${lang.code === getLang() ? ' active' : ''}`;
        li.dataset.lang = lang.code;
        li.innerHTML = `<img src="assets/svg/flag-${lang.code}.svg"
                            alt="${lang.label}" class="flag-img">
                       ${lang.label}`;
        li.addEventListener('mousedown', e => {
            e.preventDefault();
            setLang(lang.code);
            _updateBtn();
            _buildLegend();
            _buildLayerButtons();
            dropdown.classList.remove('open');
        });
        dropdown.appendChild(li);
    });

    btn.addEventListener('click', e => {
        e.stopPropagation();
        // Close any open filter dropdowns
        document.querySelectorAll('.fg-dropdown.dd-panel').forEach(el => el.classList.add('is-hidden'));
        dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    _updateBtn();
}

function _setBasemap(key) {
    if (!_tileLayers[key] || key === _current) return;
    map.removeLayer(_tileLayers[_current]);
    _tileLayers[key].addTo(map);
    _current = key;
    document.querySelectorAll('.layer-btn')
        .forEach(b => b.classList.toggle('active', b.dataset.map === key));
}

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
        document.getElementById('btn-fullscreen')?.classList.toggle('active', !!document.fullscreenElement));

    document.querySelectorAll('.stab').forEach(tab =>
        tab.addEventListener('click', () => {
            document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
            if (tab.dataset.tab === 'settings') _refreshJosmStatus();
        }));
}

/**
 * Refresh the JOSM version box in the Settings tab.
 * detectJosmVersion() caches success and retries on error, so calling this
 * on every Settings tab open is safe and gives the user a fresh probe when
 * JOSM was not yet running on the previous attempt.
 */
async function _refreshJosmStatus() {
    const body = document.getElementById('josm-detect-body');
    if (!body) return;

    // Show checking state immediately
    body.innerHTML = _josmRow(t('josm.detect.version'), `<span class="josm-val-dim">${t('josm.detect.checking')}</span>`);

    const result = await detectJosmVersion();
    _renderJosmStatus(body, result);
}

function _renderJosmStatus(body, result) {
    if (result.status === 'ok') {
        body.innerHTML =
            _josmRow(t('josm.detect.version'), `<span class="josm-val-ok">${result.version}</span>`) +
            _josmRow(t('josm.detect.protocol'), `<span class="josm-val-ok">${result.protocolMajor}.${result.protocolMinor}</span>`) +
            _josmRow(t('josm.detect.port'), `<span class="josm-val-ok">${result.port}</span>`);
    } else {
        const label = result.status === 'forbidden'
            ? t('josm.detect.notAllowed')
            : t('josm.detect.notDetected');
        body.innerHTML = _josmRow(t('josm.detect.version'), `<span class="josm-val-dim">${label}</span>`);
    }
}

function _josmRow(label, valueHtml) {
    return `<div class="panel-row josm-detect-row">
        <span class="josm-detect-label">${label}</span>${valueHtml}
    </div>`;
}

function _geolocate() {
    if (!navigator.geolocation) { alert('Geolocation not available.'); return; }
    const btn = document.getElementById('btn-geolocate');
    btn?.classList.add('active');
    navigator.geolocation.getCurrentPosition(
        pos => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            L.circle([lat, lng], { radius: accuracy, color: '#2589c7', fillOpacity: .1, weight: 1 }).addTo(map);
            L.circleMarker([lat, lng], { radius: 7, color: '#fff', fillColor: '#2589c7', fillOpacity: 1, weight: 2 })
                .addTo(map).bindPopup(`±${Math.round(accuracy)} m`);
            map.setView([lat, lng], Math.min(Math.max(map.getZoom(), 14), 17), { animate: false });
            btn?.classList.remove('active');
        },
        err => { btn?.classList.remove('active'); alert('Location error: ' + err.message); },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function _toggleFullscreen() {
    document.fullscreenElement
        ? document.exitFullscreen()
        : document.getElementById('app')?.requestFullscreen();
}

export function updateZoomStatus(zoom) {
    const el = document.getElementById('st-zoom');
    if (el) el.textContent = zoom;
}

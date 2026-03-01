/**
 * map.js — Leaflet map initialisation, basemaps, controls, legend, language picker.
 */

import { JAWG_API_KEY, MAP_INITIAL_VIEW, DEFAULT_BASEMAP } from './config.js';
import { LANGS, getLang, setLang, applyTranslations, t }  from './i18n.js';

export let map;

// Signal type groups with their display colour — must match popup.js TYPE_GROUPS
export const SIGNAL_GROUPS = [
  { key: 'main',     color: '#e85d5d' },
  { key: 'distant',  color: '#f5c842' },
  { key: 'speed',    color: '#fb923c' },
  { key: 'route',    color: '#38bdf8' },
  { key: 'stop',     color: '#60a5fa' },
  { key: 'crossing', color: '#4ade80' },
  { key: 'unknown',  color: '#6b7280' },
];

const BASEMAPS = {
  'jawg-transport': {
    labelKey: 'basemap.jawg',
    url:  `https://tile.jawg.io/jawg-transports/{z}/{x}/{y}{r}.png?access-token=${JAWG_API_KEY}`,
    opts: { attribution: '© <a href="https://jawg.io">Jawg Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 22 },
  },
  'osm': {
    labelKey: 'basemap.osm',
    url:  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 20 },
  },
  'satellite': {
    labelKey: 'basemap.satellite',
    url:  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { attribution: '© Esri, Maxar, Earthstar Geographics', maxZoom: 20 },
  },
};

const _tileLayers = {};
let _current = null;

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: false, maxZoom: 22, preferCanvas: true })
         .setView(MAP_INITIAL_VIEW.center, MAP_INITIAL_VIEW.zoom);

  Object.entries(BASEMAPS).forEach(([key, def]) => {
    _tileLayers[key] = L.tileLayer(def.url, def.opts);
  });

  // Fall back to OSM if no Jawg key is configured
  _current = (JAWG_API_KEY === 'YOUR_JAWG_ACCESS_TOKEN') ? 'osm' : DEFAULT_BASEMAP;
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
    btn.className    = `layer-btn${key === _current ? ' active' : ''}`;
    btn.dataset.map  = key;
    btn.innerHTML    = `<img src="assets/svg/${key}.svg" width="20" height="20" alt=""
                             class="layer-icon" style="opacity:.85"> ${t(def.labelKey)}`;
    btn.addEventListener('click', () => _setBasemap(key));
    list.appendChild(btn);
  });
}

function _buildLegend() {
  const body = document.getElementById('legend-body');
  if (!body) return;
  body.innerHTML = '';
  SIGNAL_GROUPS.forEach(g => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-dot" style="background:${g.color}"></span>
                     <span data-i18n="group.${g.key}">${t('group.' + g.key)}</span>`;
    body.appendChild(row);
  });
}

function _buildLangPicker() {
  const dropdown = document.getElementById('lang-dropdown');
  const btn      = document.getElementById('lang-select-btn');
  const flag     = document.getElementById('lang-flag');
  const label    = document.getElementById('lang-label');
  if (!dropdown || !btn) return;

  const _updateBtn = () => {
    const lang = getLang();
    const def  = LANGS.find(l => l.code === lang) || LANGS[0];
    if (flag)  flag.textContent  = _flagEmoji(def.code);
    if (label) label.textContent = def.label;
    dropdown.querySelectorAll('.lang-option').forEach(o =>
      o.classList.toggle('active', o.dataset.lang === lang));
  };

  dropdown.innerHTML = '';
  LANGS.forEach(lang => {
    const li = document.createElement('li');
    li.className    = `lang-option${lang.code === getLang() ? ' active' : ''}`;
    li.dataset.lang = lang.code;
    li.innerHTML    = `<span class="lang-flag-img">${_flagEmoji(lang.code)}</span> ${lang.label}`;
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

  btn.addEventListener('click', e => { e.stopPropagation(); dropdown.classList.toggle('open'); });
  document.addEventListener('click', () => dropdown.classList.remove('open'));

  _updateBtn();
}

function _flagEmoji(code) {
  // Emoji flag map avoids CSS font dependency (works on Edge/Windows)
  const flags = { en: '🇬🇧', fr: '🇫🇷' };
  return flags[code] || code.toUpperCase();
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

  document.addEventListener('fullscreenchange', () =>
    document.getElementById('btn-fullscreen')?.classList.toggle('active', !!document.fullscreenElement));

  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('sidebar-closed');
    setTimeout(() => map.invalidateSize(), 210);
  });

  document.querySelectorAll('.stab').forEach(tab =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
    }));
}

function _geolocate() {
  if (!navigator.geolocation) { alert('Geolocation not available.'); return; }
  const btn = document.getElementById('btn-geolocate');
  btn?.classList.add('active');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      L.circle([lat, lng], { radius: accuracy, color: '#2589c7', fillColor: '#2589c7', fillOpacity: .1, weight: 1 }).addTo(map);
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

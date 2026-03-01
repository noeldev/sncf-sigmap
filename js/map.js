/**
 * map.js — Leaflet map, basemaps, controls, legend.
 */

import { JAWG_API_KEY, MAP_INITIAL_VIEW, DEFAULT_BASEMAP } from './config.js';

export let map;

export const SIGNAL_GROUPS = [
  { key: 'main',     label: 'Main signals',          color: '#e85d5d' },
  { key: 'distant',  label: 'Distant signals',        color: '#f5c842' },
  { key: 'speed',    label: 'Speed limits',           color: '#fb923c' },
  { key: 'route',    label: 'Route indicators',       color: '#38bdf8' },
  { key: 'stop',     label: 'Stops & infrastructure', color: '#60a5fa' },
  { key: 'crossing', label: 'Level crossings',        color: '#4ade80' },
  { key: 'unknown',  label: 'Unsupported types',      color: '#6b7280' },
];

const BASEMAPS = {
  'jawg-transport': {
    label: 'Jawg Transport',
    color: '#2589c7',
    url:   `https://tile.jawg.io/jawg-transports/{z}/{x}/{y}{r}.png?access-token=${JAWG_API_KEY}`,
    opts:  { attribution: '© <a href="https://jawg.io">Jawg Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 22 },
  },
  'osm': {
    label: 'OpenStreetMap',
    color: '#7dcf7d',
    url:   'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts:  { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 20 },
  },
  'satellite': {
    label: 'Satellite',
    color: '#c8a96a',
    url:   'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts:  { attribution: '© Esri, Maxar, Earthstar Geographics', maxZoom: 20 },
  },
};

const _layers = {};
let _current  = null;

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: false, maxZoom: 22, preferCanvas: true })
         .setView(MAP_INITIAL_VIEW.center, MAP_INITIAL_VIEW.zoom);

  Object.entries(BASEMAPS).forEach(([key, def]) => {
    _layers[key] = L.tileLayer(def.url, def.opts);
  });

  const start = (JAWG_API_KEY === 'YOUR_JAWG_ACCESS_TOKEN') ? 'osm' : DEFAULT_BASEMAP;
  _current = start;
  _layers[start].addTo(map);

  _buildLayerButtons();
  _buildLegend();
  _buildControls();
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
    btn.innerHTML = `<span class="layer-dot" style="background:${def.color}"></span>${def.label}`;
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
    row.innerHTML = `<span class="legend-dot" style="background:${g.color};border-color:rgba(0,0,0,.3)"></span>${g.label}`;
    body.appendChild(row);
  });
}

function _setBasemap(key) {
  if (!_layers[key] || key === _current) return;
  map.removeLayer(_layers[_current]);
  _layers[key].addTo(map);
  _current = key;
  document.querySelectorAll('.layer-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.map === key));
}

function _buildControls() {
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => map.zoomIn());
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => map.zoomOut());
  document.getElementById('btn-geolocate')?.addEventListener('click', _geolocate);
  document.getElementById('btn-fullscreen')?.addEventListener('click', _toggleFullscreen);

  document.addEventListener('fullscreenchange', () => {
    document.getElementById('btn-fullscreen')
      ?.classList.toggle('active', !!document.fullscreenElement);
  });

  // Sidebar toggle
  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('sidebar-closed');
    setTimeout(() => map.invalidateSize(), 210);
  });

  // Tab switching
  document.querySelectorAll('.stab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
    });
  });

  // Language buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Minimal language switch: French labels
      _applyLang(btn.dataset.lang);
    });
  });

  // Custom toggle switch visual sync
  const chk = document.getElementById('chk-mapped-only');
  const track = chk?.closest('label')?.querySelector('.toggle-track');
  if (chk && track) {
    const sync = () => track.classList.toggle('checked', chk.checked);
    chk.addEventListener('change', sync);
    sync();
  }
}

function _applyLang(lang) {
  const FR = {
    'Filters': 'Filtres', 'Settings': 'Paramètres', 'About': 'À propos',
    '+ Add filter': '+ Ajouter', 'Reset': 'Réinitialiser',
    'Supported only': 'Supportés uniquement', 'Legend': 'Légende',
    'Base Map': 'Fond de carte', 'Language': 'Langue',
    'Signals': 'Signaux', 'Filters': 'Filtres', 'Zoom': 'Zoom',
    'Main signals': 'Signaux principaux', 'Distant signals': 'Signaux de reprise',
    'Speed limits': 'Limitations de vitesse', 'Route indicators': 'Indicateurs de voie',
    'Stops & infrastructure': 'Arrêts & infrastructures', 'Level crossings': 'Passages à niveau',
    'Unsupported types': 'Types non supportés',
    'Base map': 'Fond de carte',
  };
  const EN = Object.fromEntries(Object.entries(FR).map(([k,v]) => [v,k]));
  const dict = lang === 'fr' ? FR : EN;

  const walk = el => {
    if (!el) return;
    if (el.children.length === 0 && el.textContent.trim()) {
      const t = el.textContent.trim();
      if (dict[t]) el.textContent = dict[t];
    }
    Array.from(el.children).forEach(walk);
  };
  // Re-build legend with translated labels
  SIGNAL_GROUPS.forEach(g => { g._label_fr = g._label_fr || g.label; });
  // Just walk the sidebar
  walk(document.getElementById('sidebar'));
  document.documentElement.lang = lang;
}

function _geolocate() {
  if (!navigator.geolocation) { alert('Geolocation not available.'); return; }
  const btn = document.getElementById('btn-geolocate');
  btn?.classList.add('active');

  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    L.circle([lat, lng], { radius: accuracy, color: '#2589c7', fillColor: '#2589c7', fillOpacity: 0.1, weight: 1 }).addTo(map);
    L.circleMarker([lat, lng], { radius: 7, color: '#fff', fillColor: '#2589c7', fillOpacity: 1, weight: 2 })
      .addTo(map).bindPopup(`My position — accuracy ±${Math.round(accuracy)} m`);
    map.setView([lat, lng], Math.min(Math.max(map.getZoom(), 14), 17), { animate: false });
    btn?.classList.remove('active');
  }, err => {
    btn?.classList.remove('active');
    alert('Location error: ' + err.message);
  }, { enableHighAccuracy: true, timeout: 10000 });
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

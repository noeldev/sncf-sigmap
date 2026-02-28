/**
 * map.js — Leaflet map initialisation, basemaps, geolocation, fullscreen.
 */

import { JAWG_API_KEY, MAP_INITIAL_VIEW, DEFAULT_BASEMAP } from './config.js';

export let map;

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
let _geolocMarker = null;
let _geolocCircle = null;

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
  _buildControls();
  return map;
}

function _buildLayerButtons() {
  const list = document.getElementById('basemap-list');
  if (!list) return;
  list.innerHTML = '';
  Object.entries(BASEMAPS).forEach(([key, def]) => {
    const btn     = document.createElement('button');
    btn.className = 'layer-btn' + (key === _current ? ' active' : '');
    btn.dataset.map = key;
    btn.innerHTML = `<span class="layer-dot" style="background:${def.color}"></span>${def.label}`;
    btn.addEventListener('click', () => _setBasemap(key));
    list.appendChild(btn);
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
  // Custom zoom buttons
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => map.zoomIn());
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => map.zoomOut());

  // Geolocation
  document.getElementById('btn-geolocate')?.addEventListener('click', _geolocate);

  // Fullscreen
  document.getElementById('btn-fullscreen')?.addEventListener('click', _toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    document.getElementById('btn-fullscreen')
      ?.classList.toggle('fs-active', !!document.fullscreenElement);
  });

  // Sidebar toggle
  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar?.classList.toggle('sidebar-closed');
    setTimeout(() => map.invalidateSize(), 200);
  });

  // Sidebar tabs
  document.querySelectorAll('.stab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
    });
  });
}

function _geolocate() {
  if (!navigator.geolocation) { alert('Géolocalisation non disponible.'); return; }
  const btn = document.getElementById('btn-geolocate');
  btn?.classList.add('active');

  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    if (_geolocMarker) { map.removeLayer(_geolocMarker); _geolocMarker = null; }
    if (_geolocCircle) { map.removeLayer(_geolocCircle); _geolocCircle = null; }

    _geolocCircle = L.circle([lat, lng], {
      radius: accuracy, color: '#2589c7', fillColor: '#2589c7',
      fillOpacity: 0.1, weight: 1,
    }).addTo(map);

    _geolocMarker = L.circleMarker([lat, lng], {
      radius: 7, color: '#fff', fillColor: '#2589c7', fillOpacity: 1, weight: 2,
    }).addTo(map)
      .bindPopup(`📍 Votre position — précision ±${Math.round(accuracy)} m`);

    const zoom = Math.min(Math.max(map.getZoom(), 14), 17);
    map.setView([lat, lng], zoom, { animate: false });
    btn?.classList.remove('active');

  }, err => {
    btn?.classList.remove('active');
    alert('Impossible de vous localiser : ' + err.message);
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function _toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.getElementById('app')?.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

export function updateZoomStatus(zoom) {
  const el = document.getElementById('st-zoom');
  if (el) el.textContent = zoom;
}

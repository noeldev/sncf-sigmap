/**
 * map.js
 * Leaflet map initialisation, basemap switching, geolocation.
 */

import { JAWG_API_KEY, MAP_INITIAL_VIEW, DEFAULT_BASEMAP } from './config.js';

export let map;
let currentBasemap = DEFAULT_BASEMAP;
let geolocMarker   = null;
let geolocCircle   = null;

const BASEMAPS = {
  'jawg-transport': {
    label: '🚆 Jawg Transport',
    url:   `https://tile.jawg.io/jawg-transports/{z}/{x}/{y}{r}.png?access-token=${JAWG_API_KEY}`,
    opts:  { attribution: '<a href="https://www.jawg.io">© Jawg Maps</a> | <a href="https://www.openstreetmap.org">© OpenStreetMap</a>', maxZoom: 22 },
  },
  'jawg-sunny': {
    label: '☀️ Jawg Sunny',
    url:   `https://tile.jawg.io/jawg-sunny/{z}/{x}/{y}{r}.png?access-token=${JAWG_API_KEY}`,
    opts:  { attribution: '<a href="https://www.jawg.io">© Jawg Maps</a> | <a href="https://www.openstreetmap.org">© OpenStreetMap</a>', maxZoom: 22 },
  },
  'jawg-dark': {
    label: '🌙 Jawg Dark',
    url:   `https://tile.jawg.io/jawg-dark/{z}/{x}/{y}{r}.png?access-token=${JAWG_API_KEY}`,
    opts:  { attribution: '<a href="https://www.jawg.io">© Jawg Maps</a> | <a href="https://www.openstreetmap.org">© OpenStreetMap</a>', maxZoom: 22 },
  },
  'osm': {
    label: '🗺️ OSM Standard',
    url:   'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts:  { attribution: '© <a href="https://www.openstreetmap.org">OpenStreetMap</a>', maxZoom: 20 },
  },
  'satellite': {
    label: '🛰️ Satellite',
    url:   'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts:  { attribution: '© Esri', maxZoom: 20 },
  },
};

const _layers = {};

export function initMap(containerId) {
  map = L.map(containerId, {
    zoomControl:  false,
    maxZoom:      22,
    preferCanvas: true,
  }).setView(MAP_INITIAL_VIEW.center, MAP_INITIAL_VIEW.zoom);

  Object.entries(BASEMAPS).forEach(([key, def]) => {
    _layers[key] = L.tileLayer(def.url, def.opts);
  });

  const startMap = JAWG_API_KEY === 'YOUR_JAWG_ACCESS_TOKEN' ? 'osm' : currentBasemap;
  currentBasemap = startMap;
  _layers[currentBasemap].addTo(map);

  if (JAWG_API_KEY === 'YOUR_JAWG_ACCESS_TOKEN') {
    console.warn('[Map] Jawg key not set — falling back to OSM.');
  }

  L.control.zoom({ position: 'topleft' }).addTo(map);
  _buildBasemapControl();
  _buildGeolocControl();
  return map;
}

function _buildBasemapControl() {
  const ctrl = document.getElementById('basemap-selector');
  if (!ctrl) return;
  ctrl.innerHTML = '';
  Object.entries(BASEMAPS).forEach(([key, def]) => {
    const btn = document.createElement('button');
    btn.className   = 'basemap-btn' + (key === currentBasemap ? ' active' : '');
    btn.dataset.map = key;
    btn.textContent = def.label;
    btn.addEventListener('click', () => setBasemap(key));
    ctrl.appendChild(btn);
  });
}

export function setBasemap(key) {
  if (!_layers[key]) return;
  map.removeLayer(_layers[currentBasemap]);
  _layers[key].addTo(map);
  currentBasemap = key;
  document.querySelectorAll('.basemap-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.map === key)
  );
}

// ---- Geolocation ----
function _buildGeolocControl() {
  document.getElementById('btn-geolocate')?.addEventListener('click', geolocate);
}

export function geolocate() {
  if (!navigator.geolocation) {
    alert('Geolocation is not available in this browser.');
    return;
  }
  const btn = document.getElementById('btn-geolocate');
  if (btn) btn.classList.add('loading');

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (geolocMarker) map.removeLayer(geolocMarker);
      if (geolocCircle)  map.removeLayer(geolocCircle);

      geolocCircle = L.circle([lat, lng], {
        radius: accuracy, color: '#60a5fa', fillColor: '#60a5fa',
        fillOpacity: 0.1, weight: 1,
      }).addTo(map);

      geolocMarker = L.circleMarker([lat, lng], {
        radius: 7, color: '#fff', fillColor: '#60a5fa', fillOpacity: 1, weight: 2,
      }).addTo(map)
        .bindPopup(`📍 Your location<br><small>Accuracy: ±${Math.round(accuracy)} m</small>`);

      // Clamp zoom to avoid rate-limiting burst on Jawg free plan
      // and jump without animation to avoid triggering many intermediate tile requests
      const targetZoom = Math.min(map.getZoom() < 12 ? 14 : map.getZoom(), 16);
      map.setView([lat, lng], targetZoom, { animate: false });

      if (btn) btn.classList.remove('loading');
    },
    err => {
      console.warn('[Geoloc]', err.message);
      if (btn) btn.classList.remove('loading');
      alert('Unable to retrieve your location: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/**
 * map.js — Leaflet map, basemaps (Transport + OSM + Satellite), geolocation.
 */

import { JAWG_API_KEY, MAP_INITIAL_VIEW, DEFAULT_BASEMAP } from './config.js';

export let map;
let currentBasemap = null;
let geolocMarker   = null;
let geolocCircle   = null;

const BASEMAPS = {
  'jawg-transport': {
    label: '🚆 Transport',
    url:   `https://tile.jawg.io/jawg-transports/{z}/{x}/{y}{r}.png?access-token=${JAWG_API_KEY}`,
    opts:  { attribution: '© <a href="https://jawg.io">Jawg</a> © <a href="https://openstreetmap.org">OSM</a>', maxZoom: 22 },
  },
  'osm': {
    label: '🗺 OSM',
    url:   'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts:  { attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom: 20 },
  },
  'satellite': {
    label: '🛰 Satellite',
    url:   'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts:  { attribution: '© Esri', maxZoom: 20 },
  },
};

const _layers = {};

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: false, maxZoom: 22, preferCanvas: true })
         .setView(MAP_INITIAL_VIEW.center, MAP_INITIAL_VIEW.zoom);

  Object.entries(BASEMAPS).forEach(([key, def]) => {
    _layers[key] = L.tileLayer(def.url, def.opts);
  });

  const start = (JAWG_API_KEY === 'YOUR_JAWG_ACCESS_TOKEN') ? 'osm' : DEFAULT_BASEMAP;
  currentBasemap = start;
  _layers[start].addTo(map);

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
    const btn       = document.createElement('button');
    btn.className   = 'basemap-btn' + (key === currentBasemap ? ' active' : '');
    btn.dataset.map = key;
    btn.textContent = def.label;
    btn.addEventListener('click', () => _setBasemap(key));
    ctrl.appendChild(btn);
  });
}

function _setBasemap(key) {
  if (!_layers[key] || key === currentBasemap) return;
  map.removeLayer(_layers[currentBasemap]);
  _layers[key].addTo(map);
  currentBasemap = key;
  document.querySelectorAll('.basemap-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.map === key));
}

// ── Geolocation ───────────────────────────────────────────────────────────

function _buildGeolocControl() {
  document.getElementById('btn-geolocate')?.addEventListener('click', _geolocate);
}

function _geolocate() {
  if (!navigator.geolocation) { alert('Geolocation not available.'); return; }
  const btn = document.getElementById('btn-geolocate');
  btn?.classList.add('loading');

  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;

    if (geolocMarker) { map.removeLayer(geolocMarker); geolocMarker = null; }
    if (geolocCircle) { map.removeLayer(geolocCircle); geolocCircle = null; }

    geolocCircle = L.circle([lat, lng], {
      radius: accuracy, color: '#60a5fa', fillColor: '#60a5fa',
      fillOpacity: 0.12, weight: 1,
    }).addTo(map);

    geolocMarker = L.circleMarker([lat, lng], {
      radius: 7, color: '#fff', fillColor: '#60a5fa', fillOpacity: 1, weight: 2,
    }).addTo(map)
      .bindPopup(`📍 Votre position<br><small>Précision : ±${Math.round(accuracy)} m</small>`);

    // Jump without animation — avoids tile burst on Jawg free plan
    const zoom = Math.max(map.getZoom(), 14);
    map.setView([lat, lng], Math.min(zoom, 17), { animate: false });
    btn?.classList.remove('loading');

  }, err => {
    btn?.classList.remove('loading');
    alert('Localisation impossible : ' + err.message);
  }, { enableHighAccuracy: true, timeout: 10000 });
}

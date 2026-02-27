/**
 * app.js
 * Main entry point: auto-loads bundled data, falls back to manual file loading,
 * orchestrates the Web Worker, renders markers, and wires the UI.
 */

import { initMap, map } from './map.js';
import { initFilters, matchesFilters, resetFilters, initAddFilterButton } from './filters.js';
import { openSignalPopup, getTypeColor } from './popup.js';
import { saveDataset, loadDataset, deleteDataset } from './storage.js';
import { DATA_URLS } from './config.js';

// ---- State ----
let allSignals   = [];
let markersLayer = null;
let markerIndex  = {};   // latlng key → signal[]

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  initMap('map');
  markersLayer = L.layerGroup().addTo(map);

  _wireFileInput();
  _wireDatasetManager();

  initAddFilterButton(document.getElementById('btn-add-filter'));
  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    resetFilters();
    _renderMarkers();
  });

  // 1. Try IndexedDB cache first (instant, no parsing needed)
  const restored = await _tryRestoreCache();

  // 2. If nothing cached, try to fetch the bundled data file
  if (!restored && DATA_URLS.signals) {
    await _fetchBundledData(DATA_URLS.signals);
  }
});

// ---- Bundled data auto-fetch ----
async function _fetchBundledData(url) {
  _setProgress(true, `Loading ${url.split('/').pop()}…`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // File not present in repo — silently skip, manual load is still available
      console.info(`[Data] ${url} not available (${res.status}) — manual load required.`);
      _setFileName('No file loaded');
      _setProgress(false);
      return;
    }
    const text = await res.text();
    _setProgress(true, 'Parsing… (this may take a few seconds)');
    _parseWithWorker(text, url.split('/').pop());
  } catch (err) {
    console.info(`[Data] Could not load ${url}:`, err.message);
    _setFileName('No file loaded');
    _setProgress(false);
  }
}

// ---- Manual file input ----
function _wireFileInput() {
  const input = document.getElementById('signals-file');
  document.getElementById('btn-load-signals')?.addEventListener('click', () => input.click());
  input?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    _setProgress(true, `Reading ${file.name}…`);
    _setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      _setProgress(true, `Parsing ${file.name}… (a few seconds)`);
      _parseWithWorker(ev.target.result, file.name);
    };
    reader.readAsText(file);
  });
}

// ---- Web Worker parsing ----
function _parseWithWorker(text, filename) {
  const worker = new Worker('./js/geojson.worker.js');

  worker.onmessage = async e => {
    const { features, error } = e.data;
    worker.terminate();

    if (error) {
      _setProgress(false);
      alert(`Parse error (${filename}): ${error}`);
      return;
    }

    allSignals = features;
    _setProgress(true, `Caching ${features.length.toLocaleString('en')} signals…`);
    await saveDataset('signals', { features, filename });
    _setFileName(filename);
    _afterSignalsLoaded();
    _setProgress(false);
  };

  worker.onerror = err => {
    worker.terminate();
    _setProgress(false);
    alert('Worker error: ' + err.message);
  };

  worker.postMessage({ type: 'signals', text });
}

// ---- Post-load setup ----
function _afterSignalsLoaded() {
  document.getElementById('record-count').textContent =
    `${allSignals.length.toLocaleString('en')} records`;
  document.getElementById('st-total').textContent = allSignals.length.toLocaleString('en');
  initFilters(allSignals, _renderMarkers);
  _renderMarkers();
  _updateCacheStatus();
}

// ---- Marker rendering ----
function _renderMarkers() {
  markersLayer.clearLayers();
  markerIndex = {};

  const visible = allSignals.filter(matchesFilters);
  document.getElementById('st-visible').textContent = visible.length.toLocaleString('en');

  // Group signals that share the exact same coordinates
  visible.forEach(s => {
    const key = `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    if (!markerIndex[key]) markerIndex[key] = [];
    markerIndex[key].push(s);
  });

  // One marker per unique position
  Object.entries(markerIndex).forEach(([key, feats]) => {
    const [lat, lng] = key.split(',').map(Number);
    const color = getTypeColor(feats[0].p.type_if);
    const multi = feats.length > 1;

    const icon = L.divIcon({
      className: '',
      html: `<div class="sig-dot${multi ? ' multi' : ''}" style="--c:${color}"></div>`,
      iconSize:    [multi ? 14 : 10, multi ? 14 : 10],
      iconAnchor:  [multi ? 7  : 5,  multi ? 7  : 5],
      popupAnchor: [0, -10],
    });

    const marker = L.marker([lat, lng], { icon });
    marker.on('click', () => openSignalPopup([lat, lng], feats, 0));
    markersLayer.addLayer(marker);
  });
}

// ---- IndexedDB cache restore ----
async function _tryRestoreCache() {
  _setProgress(true, 'Checking cache…');
  try {
    const cached = await loadDataset('signals');
    if (cached) {
      allSignals = cached.features;
      _setFileName(cached.filename + ' ✓ cached');
      _afterSignalsLoaded();
      _setProgress(false);
      return true;
    }
  } catch (err) {
    console.warn('[Cache] Restore failed:', err);
  }
  _setFileName('No file loaded');
  _setProgress(false);
  return false;
}

// ---- Cache clear button ----
function _wireDatasetManager() {
  document.getElementById('btn-clear-signals')?.addEventListener('click', async () => {
    if (!confirm('Clear the signals cache?')) return;
    await deleteDataset('signals');
    allSignals = [];
    markersLayer.clearLayers();
    markerIndex = {};
    document.getElementById('record-count').textContent = 'No data loaded';
    document.getElementById('st-total').textContent   = '0';
    document.getElementById('st-visible').textContent = '0';
    _setFileName('No file loaded');
    _updateCacheStatus();
  });
}

function _updateCacheStatus() {
  const el = document.getElementById('cache-status');
  if (!el) return;
  el.textContent = allSignals.length > 0
    ? `💾 ${allSignals.length.toLocaleString('en')} signals cached`
    : '';
}

// ---- Helpers ----
function _setFileName(name) {
  const el = document.getElementById('signals-file-name');
  if (el) el.textContent = name;
}

function _setProgress(visible, msg = '') {
  const overlay = document.getElementById('progress-overlay');
  const msgEl   = document.getElementById('progress-msg');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !visible);
  if (msgEl) msgEl.textContent = msg;
}

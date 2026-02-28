/**
 * app.js — Main orchestration.
 */

import { initMap, map, updateZoomStatus } from './map.js';
import { loadManifest, getTileUrlsForBounds, getManifestStats } from './tiles.js';
import { initFilters, loadFilterIndex, indexSignals, resetCounts,
         resetFilters, getActiveFiltersForWorker, initAddFilterButton } from './filters.js';
import { openSignalPopup, getTypeColor } from './popup.js';
import { MIN_ZOOM_FETCH, TILES_BASE } from './config.js';

let manifest      = null;
let markersLayer  = null;
let worker        = null;
let loadPending   = false;
let loadRunning   = false;
let _lastTileKeys = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  initMap('map');
  markersLayer = L.layerGroup().addTo(map);

  initFilters(_onFilterChange);
  initAddFilterButton(document.getElementById('btn-add-filter'));
  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    resetFilters();
    _refresh();
  });

  _setProgress(true, 'Chargement de l\'index…');
  [manifest] = await Promise.all([
    loadManifest(),
    loadFilterIndex(TILES_BASE),
  ]);

  if (!manifest) {
    _setProgress(false);
    _showZoomHint('⚠ Index non trouvé — exécutez TileBuilder d\'abord.');
    return;
  }

  const { tileCount, totalSignals } = getManifestStats(manifest);
  document.getElementById('record-count').textContent =
    `${totalSignals.toLocaleString()} signaux — ${tileCount} tuiles`;

  _setProgress(false);
  _updateZoomHint();
  updateZoomStatus(map.getZoom());

  map.on('moveend zoomend', _debounce(() => {
    _updateZoomHint();
    updateZoomStatus(map.getZoom());
    _onMapMove();
  }, 300));

  _onMapMove();
});

function _onMapMove() {
  if (map.getZoom() < MIN_ZOOM_FETCH) {
    markersLayer.clearLayers();
    resetCounts();
    document.getElementById('st-visible').textContent = '0';
    return;
  }
  _refresh();
}

function _onFilterChange() { _refresh(); }

function _refresh() {
  if (map.getZoom() < MIN_ZOOM_FETCH) return;
  if (loadRunning) { loadPending = true; return; }

  const bounds   = map.getBounds();
  const tileUrls = getTileUrlsForBounds(bounds, manifest);
  const tileKeys = new Set(tileUrls);

  if (_eqSets(tileKeys, _lastTileKeys) && !loadPending) return;
  _lastTileKeys = tileKeys;
  loadPending   = false;

  if (tileUrls.length === 0) {
    markersLayer.clearLayers();
    document.getElementById('st-visible').textContent = '0';
    return;
  }
  _runWorker(bounds, tileUrls);
}

function _runWorker(bounds, tileUrls) {
  if (worker) { worker.terminate(); worker = null; }
  loadRunning = true;
  _setProgress(true, `Chargement de ${tileUrls.length} tuile(s)…`);

  worker = new Worker('./js/geojson.worker.js');
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  worker.onmessage = e => {
    const { status, msg, signals, count } = e.data;
    if (status === 'progress') { _setProgress(true, msg); return; }

    worker.terminate(); worker = null;
    loadRunning = false;
    _setProgress(false);

    if (status === 'error') { console.error('[Worker]', e.data.error); return; }

    _renderSignals(signals);
    indexSignals(signals);
    if (loadPending) { loadPending = false; _refresh(); }
  };

  worker.onerror = err => {
    console.error('[Worker error]', err);
    worker = null; loadRunning = false; _setProgress(false);
  };

  worker.postMessage({
    type:          'fetch-tiles',
    urls:          tileUrls,
    activeFilters: getActiveFiltersForWorker(),
    bounds:        { swLat: sw.lat, swLng: sw.lng, neLat: ne.lat, neLng: ne.lng },
  });
}

function _renderSignals(signals) {
  markersLayer.clearLayers();

  const groups = {};
  signals.forEach(s => {
    const key = (s.p.code_voie && s.p.pk)
      ? `${s.p.code_voie}|${s.p.pk}`
      : `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    if (!groups[key]) groups[key] = { lat: s.lat, lng: s.lng, feats: [] };
    groups[key].feats.push(s);
  });

  Object.values(groups).forEach(({ lat, lng, feats }) => {
    const color = getTypeColor(feats[0].p.type_if);
    const multi = feats.length > 1;
    const icon  = L.divIcon({
      className: '',
      html: `<div class="sig-dot${multi ? ' multi' : ''}" style="--c:${color}"></div>`,
      iconSize:    [multi ? 14 : 10, multi ? 14 : 10],
      iconAnchor:  [multi ? 7 : 5,   multi ? 7 : 5],
    });
    L.marker([lat, lng], { icon })
      .on('click', () => openSignalPopup([lat, lng], feats, 0))
      .addTo(markersLayer);
  });

  document.getElementById('st-visible').textContent =
    Object.keys(groups).length.toLocaleString();
}

function _updateZoomHint() {
  const hint = document.getElementById('zoom-hint');
  if (hint) hint.classList.toggle('hidden', map.getZoom() >= MIN_ZOOM_FETCH);
}

function _showZoomHint(msg) {
  const hint = document.getElementById('zoom-hint');
  if (hint) { hint.textContent = msg; hint.classList.remove('hidden'); }
}

function _setProgress(visible, msg = '') {
  document.getElementById('progress-overlay')?.classList.toggle('hidden', !visible);
  const el = document.getElementById('progress-msg');
  if (el) el.textContent = msg;
}

function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function _eqSets(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

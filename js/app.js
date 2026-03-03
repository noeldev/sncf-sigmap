/**
 * app.js — Main orchestration module.
 *
 * Overview mode (zoom < OVERVIEW_MAX_ZOOM):
 *   Only primary signal types are displayed, spatially subsampled to ~100 markers.
 *
 * Detail mode (zoom >= OVERVIEW_MAX_ZOOM):
 *   All signals in the current viewport bbox, all types, no count limit.
 */

import { initMap, map, updateZoomStatus }                       from './map.js';
import { loadManifest, getTileUrlsForBounds, getManifestStats } from './tiles.js';
import { initFilters, loadFilterIndex, indexSignals, resetCounts,
         resetFilters, getActiveFiltersForWorker,
         initAddFilterButton }                                  from './filters.js';
import { openSignalPopup, getTypeColor, buildTooltip }          from './popup.js';
import { TILES_BASE, OVERVIEW_MAX_ZOOM, OVERVIEW_MAX_SIGNALS }  from './config.js';
import { t }                                                    from './i18n.js';

// Signal types shown in overview mode
const OVERVIEW_TYPES = new Set([
  'CARRE', 'CV', 'S', 'GA', 'D', 'A',
  'TIV D FIXE', 'TIV D MOB', 'TIV R MOB',
]);

let manifest      = null;
let markersLayer  = null;
let worker        = null;
let loadPending   = false;
let loadRunning   = false;
let _lastTileKeys = new Set();
let _lastZoom     = -1;

document.addEventListener('DOMContentLoaded', async () => {
  initMap('map');
  markersLayer = L.layerGroup().addTo(map);

  initFilters(_onFilterChange);
  initAddFilterButton(document.getElementById('btn-add-filter'));
  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    resetFilters(); _refresh(true);
  });

  console.info('[App] TILES_BASE:', TILES_BASE);
  _setProgress(true, t('progress.index'));

  [manifest] = await Promise.all([
    loadManifest(),
    loadFilterIndex(TILES_BASE),
  ]);

  if (!manifest) {
    _setProgress(false);
    console.error('[App] manifest.json not found at', TILES_BASE + 'manifest.json');
    return;
  }

  const { tileCount, totalSignals } = getManifestStats(manifest);
  console.info(`[App] ${totalSignals.toLocaleString()} signals across ${tileCount} tiles`);
  const count = `${totalSignals.toLocaleString()} ${t('status.signals_lower')} — ${tileCount} ${t('status.tiles_lower')}`;
  document.getElementById('record-count').textContent = count;
  // Store for language refresh
  window._sncfRecordCount = { totalSignals, tileCount };

  _setProgress(false);
  _lastZoom = map.getZoom();
  updateZoomStatus(_lastZoom);

  map.on('moveend zoomend', _debounce(() => {
    const z = map.getZoom();
    updateZoomStatus(z);
    const crossedThreshold = (_lastZoom < OVERVIEW_MAX_ZOOM) !== (z < OVERVIEW_MAX_ZOOM);
    _lastZoom = z;
    _onMapMove(crossedThreshold);
  }, 280));

  _onMapMove(true);
});

function _onMapMove(force = false) { _refresh(force); }
function _onFilterChange()         { _refresh(true);  }

function _refresh(force = false) {
  if (loadRunning) { loadPending = true; return; }

  const bounds   = map.getBounds();
  const zoom     = map.getZoom();
  const tileUrls = getTileUrlsForBounds(bounds, manifest);
  const tileKeys = new Set(tileUrls);

  if (!force && _eqSets(tileKeys, _lastTileKeys) && !loadPending) return;
  _lastTileKeys = tileKeys;
  loadPending   = false;

  if (!manifest || tileUrls.length === 0) {
    markersLayer.clearLayers();
    document.getElementById('st-visible').textContent = '0';
    _setSampledBadge(false);
    return;
  }
  _runWorker(bounds, tileUrls, zoom);
}

function _runWorker(bounds, tileUrls, zoom) {
  if (worker) { worker.terminate(); worker = null; }
  loadRunning = true;
  _setProgress(true, t('progress.tiles', tileUrls.length));

  worker           = new Worker('./js/geojson.worker.js');
  const sw         = bounds.getSouthWest();
  const ne         = bounds.getNorthEast();
  const isOverview = zoom < OVERVIEW_MAX_ZOOM;

  worker.onmessage = e => {
    const { status, msg, signals, sampled, total } = e.data;
    if (status === 'progress') { _setProgress(true, msg); return; }
    worker.terminate(); worker = null;
    loadRunning = false;
    _setProgress(false);
    if (status === 'error') { console.error('[Worker]', e.data.error); return; }
    _renderSignals(signals);
    indexSignals(signals);
    _setSampledBadge(sampled, total);
    if (loadPending) { loadPending = false; _refresh(true); }
  };

  worker.onerror = err => {
    console.error('[Worker error]', err.message);
    worker = null; loadRunning = false; _setProgress(false);
  };

  worker.postMessage({
    type:          'fetch-tiles',
    urls:          tileUrls,
    activeFilters: getActiveFiltersForWorker(),
    bounds:        { swLat: sw.lat, swLng: sw.lng, neLat: ne.lat, neLng: ne.lng },
    overviewTypes: isOverview ? [...OVERVIEW_TYPES] : null,
    maxSignals:    isOverview ? OVERVIEW_MAX_SIGNALS : null,
  });
}

function _renderSignals(signals) {
  markersLayer.clearLayers();

  // Group co-located signals by track + PK (or fallback to exact coordinates)
  const groups = {};
  for (const s of signals) {
    const key = (s.p.code_voie && s.p.pk)
      ? `${s.p.code_voie}|${s.p.pk}`
      : `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    if (!groups[key]) groups[key] = { lat: s.lat, lng: s.lng, feats: [] };
    groups[key].feats.push(s);
  }

  for (const { lat, lng, feats } of Object.values(groups)) {
    const color = getTypeColor(feats[0].p.type_if);
    const multi = feats.length > 1;
    const icon  = L.divIcon({
      className:  '',
      html:       `<div class="sig-dot${multi ? ' multi' : ''}" style="--c:${color}"></div>`,
      iconSize:   [multi ? 14 : 10, multi ? 14 : 10],
      iconAnchor: [multi ? 7  : 5,  multi ? 7  : 5 ],
    });
    L.marker([lat, lng], { icon })
      .bindTooltip(buildTooltip(feats), {
        direction: 'top', offset: [0, -6],
        className: 'sig-tooltip', sticky: false,
      })
      .on('click', () => openSignalPopup([lat, lng], feats, 0))
      .addTo(markersLayer);
  }

  document.getElementById('st-visible').textContent =
    Object.keys(groups).length.toLocaleString();
}

function _setSampledBadge(sampled, total) {
  const el = document.getElementById('st-sampled');
  if (!el) return;
  el.style.display = sampled ? 'inline' : 'none';
  if (sampled && total)
    el.title = `Overview sample — ${total.toLocaleString()} matching signals. Zoom ≥${OVERVIEW_MAX_ZOOM} for full detail.`;
}

function _setProgress(visible, msg = '') {
  document.getElementById('progress-overlay')?.classList.toggle('hidden', !visible);
  const el = document.getElementById('progress-msg');
  if (el) el.textContent = msg;
}

function _debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function _eqSets(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

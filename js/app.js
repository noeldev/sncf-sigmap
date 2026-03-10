/**
 * app.js — Main orchestration module.
 *
 * Overview mode (zoom < OVERVIEW_MAX_ZOOM):
 *   All signal types are loaded; results are spatially sampled to ~300 markers
 *   when no filters are active, so the map stays readable at national scale.
 *   Sampling is deterministic (fixed 0.1° grid), so panning does not cause
 *   markers to appear or disappear — see geojson.worker.js.
 *   When filters are active, all matching signals are shown regardless of zoom.
 *
 * Detail mode (zoom >= OVERVIEW_MAX_ZOOM):
 *   All signals in the current viewport bbox, all types, no count limit.
 *
 * Worker message format (groups):
 *   Each group = { lat, lng, all: Signal[], display: Signal[] }
 *   - display: signals passing the active filters → used for marker colour and tooltip
 *   - all:     every co-located signal regardless of filters → passed to openSignalPopup
 *             so the JOSM export is never incomplete when a filter is active.
 *
 * UI initialisation order after initMap():
 *   buildLegend → _initLangPicker → _initTabs → initFilters → applyTranslations
 *   All sidebar UI is owned here; map.js owns only the Leaflet map and its controls.
 */

import { TILES_BASE, OVERVIEW_MAX_ZOOM, OVERVIEW_MAX_SIGNALS } from './config.js';
import { initMap, map, updateZoomStatus, refreshBasemapLabels } from './map.js';
import { loadManifest, getTileUrlsForBounds, getManifestStats } from './tiles.js';
import {
    initFilters,
    loadFilterIndex,
    indexSignals,
    resetFilters,
    getActiveFiltersForWorker,
    initAddFilterButton,
} from './filters.js';
import { openSignalPopup } from './popup.js';
import { getTypeColor, getDotSize, buildLegend } from './signal-mapping.js';
import { buildTooltip } from './tooltip.js';
import { t, getLang, setLang, applyTranslations, setRecordCount } from './i18n.js';
import { Dropdown, closeAll as closeAllDropdowns } from './dropdown.js';


let manifest = null;
let markersLayer = null;
let worker = null;
let loadPending = false;
let loadRunning = false;
let _lastTileKeys = new Set();
let _lastZoom = -1;

// Cached DOM references for elements accessed on every worker message or map move.
// Populated once in _boot() after the DOM is guaranteed ready.
const _el = {};
function _cacheEls() {
    _el.progressOverlay = document.getElementById('progress-overlay');
    _el.progressMsg = document.getElementById('progress-msg');
    _el.stVisible = document.getElementById('st-visible');
    _el.stSampled = document.getElementById('st-sampled');
    _el.recordCount = document.getElementById('record-count');
}

// ES modules are deferred by spec — the DOM is guaranteed ready when this executes.
async function _boot() {
    await initMap('map');
    _cacheEls();
    markersLayer = L.layerGroup().addTo(map);

    _initLangPicker();
    _initTabs();

    buildLegend();
    initFilters(_onFilterChange);
    initAddFilterButton(document.getElementById('btn-add-filter'));
    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
        resetFilters();
        _refresh(true);
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

    setRecordCount({ totalSignals, tileCount });

    const count =
        `${totalSignals.toLocaleString()} ${t('status.signals_lower')} — ` +
        `${tileCount} ${t('status.tiles_lower')}`;
    _el.recordCount.textContent = count;

    _setProgress(false);
    _lastZoom = map.getZoom();
    updateZoomStatus(_lastZoom);

    map.on('moveend zoomend', _debounce(() => {
        const z = map.getZoom();
        updateZoomStatus(z);
        const crossedThreshold =
            (_lastZoom < OVERVIEW_MAX_ZOOM) !== (z < OVERVIEW_MAX_ZOOM);
        _lastZoom = z;
        _onMapMove(crossedThreshold);
    }, 280));

    _onMapMove(true);

    applyTranslations();
}

_boot();

// ===== Sidebar: language picker =====

function _initLangPicker() {
    const dropdown = document.getElementById('lang-dropdown');
    const btn = document.getElementById('lang-select-btn');
    if (!dropdown || !btn) return;

    // Start hidden — Dropdown controller manages visibility via .is-hidden.
    dropdown.classList.add('is-hidden');

    const _updateBtn = () => {
        const lang = getLang();
        const option = dropdown.querySelector(`[data-val="${lang}"]`);
        const flagEl = document.getElementById('lang-flag');
        const lblEl = document.getElementById('lang-label');

        if (flagEl && option) {
            const imgSrc = option.querySelector('img')?.src;
            let img = flagEl.querySelector('img');
            if (!img) { img = document.createElement('img'); img.className = 'flag-img'; flagEl.appendChild(img); }
            if (imgSrc) img.src = imgSrc;
            img.alt = option.querySelector('span')?.textContent || '';
        }
        if (lblEl && option) lblEl.textContent = option.querySelector('span')?.textContent || lang;

        dropdown.querySelectorAll('.lang-option').forEach(o =>
            o.classList.toggle('active', o.dataset.val === lang)
        );
    };

    const _activate = (val) => {
        setLang(val);
        _updateBtn();
        refreshBasemapLabels();
        langDd.close();
    };

    // Dropdown handles: ARIA (aria-expanded, role=listbox, role=option),
    // keyboard navigation, and outside-click closing.
    const langDd = new Dropdown({
        panel: document.getElementById('lang-select-wrap'),
        dropdownEl: dropdown,
        triggerEl: btn,
        listEl: dropdown,
        itemSel: '.lang-option',
        onActivate: _activate,
    });

    // Mouse activation: delegate to list container to avoid per-item listeners.
    dropdown.addEventListener('mousedown', e => {
        const opt = e.target.closest('.lang-option');
        if (!opt) return;
        e.preventDefault();
        _activate(opt.dataset.val);
    });

    // Button click: close every other open dropdown, then toggle this one.
    // closeAllDropdowns() goes through the shared registry so each instance's
    // _open flag stays in sync with the DOM — unlike raw classList manipulation.
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = langDd.isOpen();
        closeAllDropdowns();
        if (!wasOpen) langDd.open();
    });
    // Outside-click closing handled by Dropdown's shared registry in dropdown.js.

    _updateBtn();
}

// ===== Sidebar: tabs =====

function _initTabs() {
    document.querySelectorAll('.stab').forEach(tab =>
        tab.addEventListener('click', () => {
            // Close any open dropdown before switching panels so it doesn't
            // remain visible behind a different tab's content.
            closeAllDropdowns();
            document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
            if (tab.dataset.tab === 'settings') _refreshJosmStatus();
        })
    );
}

async function _refreshJosmStatus() {
    const body = document.getElementById('josm-detect-body');
    if (!body) return;

    body.dataset.josmStatus = 'checking';

    const { josmGetVersion } = await import('./josm.js');
    const result = await josmGetVersion();
    body.dataset.josmStatus = result.status;

    if (result.status === 'ok') {
        document.getElementById('josm-val-version').textContent = result.version;
        document.getElementById('josm-val-protocol').textContent =
            `${result.protocolMajor}.${result.protocolMinor}`;
        document.getElementById('josm-val-port').textContent = result.port;
    }
}

// ===== Map refresh logic =====

function _onMapMove(force = false) { _refresh(force); }
function _onFilterChange() { _refresh(true); }

function _refresh(force = false) {
    if (loadRunning) { loadPending = true; return; }

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const tileUrls = getTileUrlsForBounds(bounds, manifest);
    const tileKeys = new Set(tileUrls);

    if (!force && _eqSets(tileKeys, _lastTileKeys) && !loadPending) return;
    _lastTileKeys = tileKeys;
    loadPending = false;

    if (!manifest || tileUrls.length === 0) {
        markersLayer.clearLayers();
        if (_el.stVisible) _el.stVisible.textContent = '0';
        _setSampledBadge(false);
        return;
    }
    _runWorker(bounds, tileUrls, zoom);
}

function _runWorker(bounds, tileUrls, zoom) {
    if (worker) { worker.terminate(); worker = null; }
    loadRunning = true;
    _setProgress(true, t('progress.tiles', tileUrls.length));

    worker = new Worker(new URL('geojson.worker.js', import.meta.url));
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const isOverview = zoom < OVERVIEW_MAX_ZOOM;

    const _workerDone = () => {
        if (worker) { worker.terminate(); worker = null; }
        loadRunning = false;
        _setProgress(false);
    };

    worker.onmessage = e => {
        const { status, msg, groups, sampled, total } = e.data;
        if (status === 'progress') { _setProgress(true, msg); return; }
        _workerDone();
        if (status === 'error') { console.error('[Worker]', e.data.error); return; }
        _renderGroups(groups);
        // Index ALL signals (unfiltered per group) so filter counts remain accurate.
        indexSignals(groups.flatMap(g => g.all));
        _setSampledBadge(sampled, total);
        if (loadPending) { loadPending = false; _refresh(true); }
    };

    worker.onerror = err => {
        console.error('[Worker error]', err.message);
        _workerDone();
    };

    worker.postMessage({
        type: 'fetch-tiles',
        urls: tileUrls,
        activeFilters: getActiveFiltersForWorker(),
        bounds: { swLat: sw.lat, swLng: sw.lng, neLat: ne.lat, neLng: ne.lng },
        maxSignals: isOverview ? OVERVIEW_MAX_SIGNALS : null,
    });
}

/**
 * Render markers from worker groups.
 * - Marker colour and tooltip use group.display (filtered signals only).
 * - Popup receives group.all so the JOSM export contains every co-located
 *   signal regardless of which filters are currently active.
 * - Dot size is driven by getDotSize() from signal-mapping.js (DOT_SCALE),
 *   which is the same source used by the legend size-scale row:
 *   1→10 px, 2→12 px, 3→14 px, 4→16 px, 5+→18 px.
 */
function _renderGroups(groups) {
    markersLayer.clearLayers();

    for (const { lat, lng, all, display } of groups) {
        const color = getTypeColor(display[0].p.type_if);
        const count = display.length;
        const multi = count > 1;
        const size = getDotSize(count);
        const half = size / 2;
        const icon = L.divIcon({
            className: '',
            html: `<div class="sig-dot${multi ? ' multi' : ''}" style="--c:${color};--sz:${size}px"></div>`,
            iconSize: [size, size],
            iconAnchor: [half, half],
        });
        L.marker([lat, lng], { icon })
            .bindTooltip(buildTooltip(display), {
                direction: 'top',
                offset: [0, -6],
                className: 'sig-tooltip',
                sticky: false,
            })
            .on('click', () => openSignalPopup([lat, lng], all, 0))
            .addTo(markersLayer);
    }

    if (_el.stVisible) _el.stVisible.textContent = groups.length.toLocaleString();
}

function _setSampledBadge(sampled, total) {
    const el = _el.stSampled;
    if (!el) return;
    el.classList.toggle('is-hidden', !sampled);
    if (sampled && total) el.title = t('status.sampled_title', total, OVERVIEW_MAX_ZOOM);
}

function _setProgress(visible, msg = '') {
    _el.progressOverlay?.classList.toggle('hidden', !visible);
    if (_el.progressMsg) _el.progressMsg.textContent = msg;
}

function _debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function _eqSets(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

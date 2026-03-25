/**
 * signal-popup.js — Unified signal popup with two tabs.
 *
 * Tab "Signals" — SNCF open data fields for the current signal,
 *                 OSM existence check per signal, Signal Node counter.
 * Tab "OSM Tags" — generated OSM tags for the current node,
 *                  Copy tags and Open in JOSM actions.
 *
 * A single Leaflet popup is opened and its content updated in-place on
 * every navigation / tab switch — no popup is replaced or re-opened.
 *
 * NOTE — unfiltered features:
 *   openSignalPopup() always receives the COMPLETE set of co-located features
 *   (group.all from the worker). Filters control marker visibility only.
 *
 * Public API:
 *   openSignalPopup(latlng, feats, idx?, startTab?)
 */

import { map } from './map.js';
import { getTypeColor, getOsmNodes, isSupported } from './signal-mapping.js';
import { t, translateElement, onLangChange } from './translation.js';
import { checkSignalGroup, invalidateSignalGroup } from './overpass.js';
import { josmAddNode } from './josm.js';
import { getLineLabel, getBlockType } from './block-system.js';
import { getSkipJosmConfirm, getAutoTagsTab } from './prefs.js';


/* ===== Template accessor ===== */

const _tplPopup = () => document.getElementById('tpl-signal-popup');
const _tplTagRow = () => document.getElementById('tpl-osm-tag-row');


/* ===== Contrast helper ===== */

function _contrastColor(hex) {
    if (!hex) return '#fff';
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) >= 128 ? '#000' : '#fff';
}


// ===== Tab identifiers =====
// Private — external callers use resolveStartTab() to get a tab name.
const TAB_SIGNALS = 'signals';
const TAB_TAGS = 'tags';

/**
 * Return the tab to open when a marker is clicked.
 * @param {boolean} flipped  true when the user held Shift or Ctrl
 * @returns {'signals'|'tags'}
 */
export function resolveStartTab(flipped) {
    const defaultTab = getAutoTagsTab() ? TAB_TAGS : TAB_SIGNALS;
    return flipped
        ? (defaultTab === TAB_TAGS ? TAB_SIGNALS : TAB_TAGS)
        : defaultTab;
}


/* ===== Module state ===== */

let _popup = null;     // Leaflet popup instance
let _popupEl = null;   // live .pu-wrap DOM node
let _feats = null;
let _latlng = null;
let _statuses = null;
let _currentIdx = 0;      // index of the signal shown in the Signals tab
let _nodes = null;
let _featToNodeIdx = null;
let _currentNodeIdx = -1;  // node index of the currently displayed signal
let _tagsNodeIdx = 0;      // node index shown in the OSM Tags tab
let _activeTab = TAB_SIGNALS;


/* ===== Language change handling ===== */

// Re-translate all dynamic popup content when the language changes.
// Both panels must be refreshed: Signals for direction/placement values,
// Tags for the node counter label.
// Guard: no-op when no popup is open.
onLangChange(() => {
    if (!_popup?.isOpen() || !_popupEl) return;
    _updateSignalsPanel();
    _updateTagsPanel();
});


/* ===== Public entry point ===== */

/**
 * Open the unified popup for a co-located signal group.
 * @param {[number,number]} latlng
 * @param {object[]}        feats
 * @param {number}          [idx=0]     initial signal index
 * @param {string}          [startTab]  tab to open first — use resolveStartTab()
 */
export function openSignalPopup(latlng, feats, idx = 0, startTab = TAB_SIGNALS) {
    _initState(latlng, feats, idx, startTab);
    _openPopup();
    _scheduleOsmCheck();
}


/* ===== Initialisation ===== */

/**
 * Reset module state for a new popup.
 * Pre-sets _statuses so the Signals panel has the correct initial OSM state:
 *   supported   → 'checking'    (Overpass will update)
 *   unsupported → 'unsupported' (locate button shown immediately)
 */
function _initState(latlng, feats, idx, startTab) {
    if (_popup) { _popup.remove(); _popup = null; }
    _feats = feats;
    _latlng = latlng;
    _currentIdx = idx;
    _activeTab = startTab ?? TAB_SIGNALS;
    _tagsNodeIdx = 0;
    _currentNodeIdx = -1;

    _statuses = feats.map(f =>
        isSupported(f.p.signalType)
            ? { status: 'checking', nodeId: null }
            : { status: 'unsupported', nodeId: null }
    );

    _computeNodes();
}

/** Recompute OSM node groups from the current feature list. */
function _computeNodes() {
    const result = getOsmNodes(_feats);
    _nodes = result.nodes;
    _featToNodeIdx = result.featToNodeIdx;
}

function _openPopup() {
    const wrap = _tplPopup().content.cloneNode(true).querySelector('.pu-wrap');
    translateElement(wrap);
    _popupEl = wrap;

    _updateSignalsPanel();
    _updateTagsPanel();
    _switchTab(_activeTab);

    _popup = L.popup({

        autoPan: true,
        closeButton: false,
        className: 'pu-leaflet',
    }).setLatLng(_latlng).setContent(wrap);

    // Register BEFORE openOn() — Leaflet fires 'popupopen' synchronously.
    map.once('popupopen', () => {
        const el = _popup?.getElement();
        if (!el) return;
        el.addEventListener('click', _onClick);
        _trapFocus(el);
        _initKeyboard(el);
    });

    _popup.openOn(map);
}


/* ===== OSM check ===== */

/**
 * Fire the Overpass check for any feat still in 'checking' state.
 * Updates the OSM status elements in-place when the result arrives.
 */
function _scheduleOsmCheck(force = false) {
    if (!_statuses.some(s => s.status === 'checking')) return;
    checkSignalGroup(_feats, force).then(results => {
        _statuses = results;
        if (!_popup?.isOpen() || !_popupEl) return;
        const idRow = _idRow();
        if (!idRow) return;
        _resetOsmStatus(idRow);
        _applyOsmStatus(idRow, _statuses[_currentIdx], _feats[_currentIdx]);
    });
}

/** Shorthand — the networkId row element. */
function _idRow() {
    return _popupEl?.querySelector('.pu-row[data-field="networkId"]');
}

/**
 * Reset OSM status indicators to their default 'checking' visual state.
 * Called before applying a new status so stale indicators are cleared.
 */
function _resetOsmStatus(idRow) {
    idRow.querySelector('.osm-checking').classList.remove('is-hidden');
    idRow.querySelector('.osm-in-osm')?.classList.add('is-hidden');
    idRow.querySelector('.osm-locate')?.classList.add('is-hidden');
    idRow.querySelector('.osm-retry')?.classList.add('is-hidden');
}

function _applyOsmStatus(idRow, { status, nodeId }, feat) {
    if (status === 'checking') return;   // keep default 'checking' visible

    idRow.querySelector('.osm-checking').classList.add('is-hidden');

    if (status === 'in-osm') {
        const link = idRow.querySelector('.osm-in-osm');
        link.classList.remove('is-hidden');
        link.href = `https://www.openstreetmap.org/node/${nodeId}`;
        const lbl = t('osm.inOsm', nodeId);
        link.title = lbl;
        link.setAttribute('aria-label', lbl);
    } else if (status === 'not-in-osm' || status === 'unsupported') {
        const link = idRow.querySelector('.osm-locate');
        link.classList.remove('is-hidden');
        link.href = `https://www.openstreetmap.org/?mlat=${feat.lat.toFixed(6)}&mlon=${feat.lng.toFixed(6)}&zoom=18`;
    } else if (status === 'error') {
        idRow.querySelector('.osm-retry').classList.remove('is-hidden');
    }
}


/* ===== In-place DOM updates ===== */

// Fields resolved directly from p — block system fields are resolved separately below.
// Field rows are read from the DOM template via [data-field] — no hardcoded list needed.

/**
 * Update every element in the Signals tab panel for _currentIdx.
 * Does not touch the OSM Tags panel.
 *
 * lineName and blockType are not in tile data; they are resolved
 * at display time via the block-system module (index.json lookup). A shallow
 * displayProps object merges p with the two resolved values so the DATA_FIELDS
 * loop can treat all fields uniformly without mutating the original p.
 */
function _updateSignalsPanel() {
    if (!_popupEl) return;
    const s = _feats[_currentIdx];
    const p = s.p;

    _updateSignalColor(p);
    _updateNavHeader(p, _feats.length);
    _updateDataRows(p);
    _updateNetworkIdRow(s);
    _updateCoords(s);
    _updateNodeBadge(s);
    // Re-translate labels last — .pu-label elements carry data-i18n;
    // .pu-val elements do not, so content written above is preserved.
    translateElement(_popupEl);
}

/** Set the --signal-color and --signal-contrast CSS variables on the popup. */
function _updateSignalColor(p) {
    const color = getTypeColor(p.signalType);
    _popupEl.style.setProperty('--signal-color', color);
    _popupEl.style.setProperty('--signal-contrast', _contrastColor(color));
}

/** Update the signal nav header: counter label, arrow button visibility, type badge. */
function _updateNavHeader(p, total) {
    _popupEl.querySelector('.pu-nav-label').textContent =
        t('popup.navLabel', _currentIdx + 1, total);
    _popupEl.querySelectorAll('[data-action="nav-prev"], [data-action="nav-next"]')
        .forEach(btn => btn.classList.toggle('is-hidden', total <= 1));
    _popupEl.querySelector('.pu-row[data-field="signalType"] .pu-badge').textContent =
        p.signalType ?? '';
}

/**
 * Populate all .pu-row[data-field] values from displayProps.
 * signalType, networkId, coords are skipped — each has its own dedicated updater.
 * lineName and blockType are resolved from the block system at display time.
 */
function _updateDataRows(p) {
    const displayProps = _buildDisplayProps(p);
    _popupEl.querySelectorAll('.pu-row[data-field]').forEach(row => {
        const field = row.dataset.field;
        if (field === 'signalType' || field === 'networkId' || field === 'coords') return;
        const val = displayProps[field];
        if (val !== undefined) row.querySelector('.pu-val').textContent = val;
    });
}

/**
 * Merge raw signal props with block-system-resolved and translated values.
 * Returns a flat object keyed by data-field names — no mutation of the original p.
 */
function _buildDisplayProps(p) {
    return {
        ...p,
        lineName: getLineLabel(p.lineCode) ?? t('popup.nodeNA'),
        blockType: getBlockType(p.lineCode, p.milepost, p.direction) ?? t('popup.nodeNA'),
        direction: t(`values.direction.${p.direction}`),
        placement: t(`values.placement.${p.placement}`),
    };
}

/** Write networkId text and refresh the OSM status indicator for the current signal. */
function _updateNetworkIdRow(s) {
    const idRow = _idRow();
    idRow.querySelector('.pu-val').textContent = s.p.networkId ?? '';
    _resetOsmStatus(idRow);
    _applyOsmStatus(idRow, _statuses[_currentIdx], s);
}

/** Write the lat/lng coordinate pair to the coords row. */
function _updateCoords(s) {
    _popupEl.querySelector('.pu-row[data-field="coords"] .pu-val').textContent =
        `${s.lat.toFixed(6)}  ${s.lng.toFixed(6)}`;
}

function _updateNodeBadge(s) {
    const nodeIdx = _featToNodeIdx?.get(s);
    _currentNodeIdx = nodeIdx ?? -1;
    const nodeCounter = _popupEl.querySelector('.pu-node-counter');

    if (nodeIdx === undefined) {
        nodeCounter.textContent = t('popup.nodeNA');
    } else {
        nodeCounter.textContent = t('popup.nodeLabel', nodeIdx + 1, _nodes.length);
        // Sync Tags tab to the node of the currently displayed signal.
        _tagsNodeIdx = nodeIdx;
    }
}

/**
 * Update every element in the OSM Tags tab panel for _tagsNodeIdx.
 * Does not touch the Signals panel.
 */
function _updateTagsPanel() {
    if (!_popupEl) return;
    const total = _nodes.length;
    const node = total > 0 ? _nodes[_tagsNodeIdx] : null;

    // Node navigation
    const nodeLabel = _popupEl.querySelector('.pu-tags-node-label');
    nodeLabel.textContent = total > 0 ? t('popup.nodeLabel', _tagsNodeIdx + 1, total) : '–';
    _popupEl.querySelectorAll('.pu-tags-arrow').forEach(btn =>
        btn.classList.toggle('is-hidden', total <= 1)
    );

    // Tags list
    const list = _popupEl.querySelector('.pu-tags-list');
    list.replaceChildren();
    if (node?.tags?.size) {
        const frag = document.createDocumentFragment();
        const tplRow = _tplTagRow();
        for (const [k, v] of node.tags.entries()) {
            const row = tplRow.content.cloneNode(true).querySelector('.pu-osm-row');
            row.querySelector('.pu-osm-key').textContent = k;
            row.querySelector('.pu-osm-val').textContent = v;
            frag.appendChild(row);
        }
        list.appendChild(frag);
    }

    // Footer buttons
    const hasNode = !!node?.tags?.size;
    _popupEl.querySelector('[data-action="copy"]').disabled = !hasNode;
    _popupEl.querySelector('[data-action="josm"]').disabled = !hasNode;
}


/* ===== Tab management ===== */

function _switchTab(tab) {
    _activeTab = tab;
    if (!_popupEl) return;
    _popupEl.querySelectorAll('.pu-tab-panel').forEach(panel => {
        const active = panel.dataset.tab === tab;
        panel.classList.toggle('is-hidden', !active);
        // inert removes the hidden panel from the accessibility tree and
        // prevents keyboard focus from reaching its interactive elements.
        if (active) panel.removeAttribute('inert');
        else panel.setAttribute('inert', '');
    });
    _popupEl.querySelectorAll('.pu-tab-btn').forEach(btn => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });
}


/* ===== Click handler ===== */

/** Step the current signal index by delta (-1 or +1), wrapping around. */
function _navigateSignal(delta) {
    _currentIdx = (_currentIdx + delta + _feats.length) % _feats.length;
    _computeNodes();
    _updateSignalsPanel();
    _updateTagsPanel();
}


/** Step the tags node index by delta (-1 or +1), wrapping around. */
function _navigateNode(delta) {
    _tagsNodeIdx = (_tagsNodeIdx + delta + _nodes.length) % _nodes.length;
    _updateTagsPanel();
}


function _onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();

    switch (btn.dataset.action) {

        case 'close':
            _popup?.remove();
            _popup = null;
            break;

        case 'nav-prev':
            _navigateSignal(-1);
            break;

        case 'nav-next':
            _navigateSignal(+1);
            break;

        case 'node-preview':   // fallthrough — badge click = open Tags tab
        case 'tab-tags':
            // Sync Tags tab to the node of the currently displayed signal.
            if (_currentNodeIdx >= 0) _tagsNodeIdx = _currentNodeIdx;
            _updateTagsPanel();
            _switchTab(TAB_TAGS);
            break;

        case 'tab-signals':
            _switchTab(TAB_SIGNALS);
            break;

        case 'tags-prev':
            _navigateNode(-1);
            break;

        case 'tags-next':
            _navigateNode(+1);
            break;

        case 'copy':
            _copyTags(_nodes[_tagsNodeIdx], btn);
            break;

        case 'josm':
            _sendToJOSM(_nodes[_tagsNodeIdx], btn);
            break;

        case 'osm-retry':
            _statuses = _statuses.map(s =>
                s.status === 'error' ? { status: 'checking', nodeId: null } : s
            );
            _resetOsmStatus(_idRow());
            _scheduleOsmCheck(true);
            break;
    }
}


/* ===== Actions ===== */

function _copyTags(node, btn) {
    if (!node?.tags?.size) return;
    invalidateSignalGroup(_feats);
    const text = [...node.tags.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
    navigator.clipboard.writeText(text)
        .then(() => _flash(btn))
        .catch(() => prompt(t('popup.copyPrompt'), text));
}

async function _sendToJOSM(node, btn) {
    if (!node?.tags?.size) return;

    if (!getSkipJosmConfirm() && _statuses?.some(s => s.status === 'in-osm')) {
        const msg = _feats.length > 1 ? t('osm.warnMulti') : t('osm.warnSingle');
        if (!confirm(msg)) return;
    }

    // Small lat offset per node so separately created nodes don't overlap in JOSM.
    const lat = _latlng[0] + node.index * 0.00001;

    try {
        await josmAddNode([lat, _latlng[1]], node.tags);
        invalidateSignalGroup(_feats);
        _flash(btn);
    } catch (err) {
        console.warn('[JOSM]', err.message);
        alert(`${t('josm.notReachable')}: ${err.message}`);
    }
}

function _flash(btn) {
    if (!btn) return;
    btn.classList.add('is-flash');
    setTimeout(() => btn.classList.remove('is-flash'), 2400);
}


/* ===== Accessibility ===== */

function _trapFocus(popupEl) {
    if (!popupEl) return;
    popupEl.tabIndex = -1;
    requestAnimationFrame(() => {
        const first = popupEl.querySelector(
            'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'
        );
        (first ?? popupEl).focus();
    });
}

function _initKeyboard(popupEl) {
    if (!popupEl) return;
    popupEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            _popup?.remove();
            _popup = null;
            return;
        }

        // Arrow left/right navigate signals when multiple are present.
        if (_feats.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.stopPropagation();
            e.preventDefault();
            _currentIdx = (_currentIdx + (e.key === 'ArrowRight' ? 1 : -1) + _feats.length) % _feats.length;
            _computeNodes();
            _updateSignalsPanel();
            _updateTagsPanel();
            return;
        }

        // Tab key traps focus inside the popup.
        if (e.key === 'Tab') {
            const focusable = [...popupEl.querySelectorAll(
                'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'
            )].filter(n => !n.closest('.is-hidden'));
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    });
}

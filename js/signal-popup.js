/**
 * signal-popup.js — Unified signal popup with two tabs.
 *
 * Tab "Signals"  — SNCF open data fields for the current signal, OSM existence
 *                  check per signal, Signal Node counter.
 *
 * Tab "OSM Tags" — tag list whose presentation depends on whether OSM data
 *                  is available for the current node:
 *
 *   No OSM data yet (loading / unsupported / not in OSM):
 *     - flat target tag list, no context menu (right-click = OS default).
 *
 *   OSM data available — Diff mode is implicit:
 *     - GitHub-style rendering against OSM:
 *         red   = OSM value (only in OSM, or conflicting),
 *         green = target-only / conflicting target value,
 *         orange= target value merged from OSM since popup opened,
 *         none  = target value unchanged and equal to OSM.
 *     - Unified right-click context menu:
 *         row items    → Merge   (on red rows)
 *                      → Undo    (on orange rows — user-merged values)
 *         global items → Merge all, Undo all (when target dirty)
 *     - Keyboard history navigation: Ctrl+Z / Ctrl+Y walks the per-node
 *       undo/redo stack over every data mutation in the tab.
 *
 * Per-node target state is preserved while navigating between co-located
 * nodes; everything is discarded on popup close.
 *
 * Export actions (Copy, JOSM) always use the current target Map, never the
 * raw node.tags — so user merges are honored on export.
 *
 * NOTE — unfiltered features:
 *   openSignalPopup() always receives the COMPLETE set of co-located features
 *   (group.all from the worker). Filters control marker visibility only.
 *
 * Public API:
 *   openSignalPopup(latlng, feats, idx?, startTab?)
 *   closeSignalPopup()
 *   resolveStartTab(flipped)
 */

import { map } from './map.js';
import { getTypeColor, sortSignalsByNetworkId } from './signal-mapping.js';
import { t, translateElement, onLangChange, openHelpPage } from './translation.js';
import { OsmStatusChecker } from './osm-checker.js';
import { josmAddNode } from './josm.js';
import { getLineLabel, getBlockType } from './block-system.js';
import { getSkipJosmConfirm, getAutoTagsTab } from './prefs.js';
import { isPinned, togglePin, onPinsChange } from './pins.js';
import {
    computeTagDiff,
    createTargetState,
    merge,
    mergeAll,
    undo,
    undoAll,
    undoHistory,
    redoHistory,
} from './osm-diff.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';

let _unsubscribePins = null;


// ===== Template accessors =====

const _tplPopup = () => document.getElementById('tpl-signal-popup');
const _tplTagRow = () => document.getElementById('tpl-osm-tag-row');


// ===== Contrast helper =====

function _contrastColor(hex) {
    if (!hex) return '#fff';
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) >= 128 ? '#000' : '#fff';
}


// ===== Tab identifiers =====

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


// ===== Row variants — single source of truth for diff styling =====

const VARIANT = Object.freeze({
    REMOVED: 'diff-removed',   // red   — OSM value not in target / conflict
    ADDED: 'diff-added',       // green — target value not in OSM / conflict
    MODIFIED: 'diff-modified', // orange — target value merged from OSM
});


// ===== Module state =====

let _popup = null;           // Leaflet popup instance
let _popupEl = null;         // live .pu-wrap DOM node
let _feats = null;
let _latlng = null;
let _osmChecker = null;
let _preFocusEl = null;      // element that had focus before the popup opened
let _currentIdx = 0;         // signal index shown in the Signals tab
let _currentNodeIdx = -1;    // node index of the currently displayed signal
let _tagsNodeIdx = 0;        // node index shown in the OSM Tags tab
let _activeTab = TAB_SIGNALS;

// Per-node target state — preserved across node navigation until popupclose.
// Keyed by nodeIdx so that navigating back to a previously-edited node
// restores the user's pending edits instead of discarding them.
const _tagStates = new Map();     // Map<nodeIdx, TagState>
const _appTagsByNode = new Map(); // Map<nodeIdx, Map<string,string>>


// ===== Language change handling =====

// Re-translate all dynamic popup content when the language changes.
// Both panels must be refreshed: Signals for direction/placement values,
// Tags for the node counter label. Any open context menu is closed so it
// doesn't display stale labels.
// Guard: no-op when no popup is open.
onLangChange(() => {
    if (_isSignalPopupOpen()) {
        _updateSignalsPanel();
        _updateTagsPanel();
        closeContextMenu();
    }
});


// ===== Public API =====

/**
 * Open the popup for a co-located signal group.
 * @param {[number,number]} latlng
 * @param {object[]}        feats
 * @param {number}          [idx=0]     initial signal index
 * @param {string}          [startTab]  tab to open first — use resolveStartTab()
 */
export function openSignalPopup(latlng, feats, idx = 0, startTab = TAB_SIGNALS) {
    // Save focus origin so it can be restored when the popup closes.
    _preFocusEl = document.activeElement;

    // Sort co-located signals by networkId in ascending numeric order so that
    // the prev/next navigation follows a predictable logical sequence.
    _feats = sortSignalsByNetworkId(feats);
    _initOsmChecker(_feats);

    // Build the popup content and open it on the map.
    _resetModuleState(latlng, idx);
    _createPopupContent();
    _attachPopupEvents();
    _updateSignalsPanel();
    _updateTagsPanel();
    _switchTab(startTab ?? TAB_SIGNALS);
    _popup.openOn(map);

    // Subscribe to pin changes so the pin button stays in sync.
    _subscribeToPins();
}

/**
 * Close the signal popup if one is open.
 * Safe to call when no popup is open.
 */
export function closeSignalPopup() {
    if (_unsubscribePins) _unsubscribePins();
    _unsubscribePins = null;

    _osmChecker?.abort();
    _osmChecker = null;

    _popup?.remove();
    _popup = null;
    _popupEl = null;

    // Drop all per-node edits so a fresh popup starts clean.
    _tagStates.clear();
    _appTagsByNode.clear();
    closeContextMenu();

    // Restore focus to the marker (or whatever had focus) before the popup opened.
    _preFocusEl?.focus();
    _preFocusEl = null;
}


// ===== Initialization =====

function _resetModuleState(latlng, idx) {
    _latlng = latlng;
    _currentIdx = idx;
    _tagsNodeIdx = 0;
    _currentNodeIdx = -1;
    _tagStates.clear();
    _appTagsByNode.clear();
}

function _isSignalPopupOpen() {
    return _popup?.isOpen() && _popupEl;
}

function _createPopupContent() {
    const wrap = _tplPopup().content.cloneNode(true).querySelector('.pu-wrap');
    _popup?.remove();
    _popup = L.popup({
        autoPan: true,
        closeButton: false,
        className: 'pu-leaflet',
    }).setLatLng(_latlng).setContent(wrap);
    _popupEl = wrap;
}

function _attachPopupEvents() {
    if (!_popupEl) return;
    _popupEl.addEventListener('click', _onClick);
    _trapFocus(_popupEl);
    _initKeyboard(_popupEl);

    // Single cleanup path: covers the close button, Escape, autoClose
    // (click on the map), and the context-menu close in map-layer.js.
    map.once('popupclose', closeSignalPopup);
}

function _subscribeToPins() {
    if (_unsubscribePins) _unsubscribePins();
    _unsubscribePins = onPinsChange(() => {
        if (_isSignalPopupOpen()) _updatePinButton();
    });
}

/** Fire the Overpass check for any feat still in 'checking' state. */
function _initOsmChecker(feats) {
    _osmChecker = new OsmStatusChecker(feats, _onOsmStatusChange);
    _osmChecker?.check();
}


// ===== OSM check =====

/**
 * Called by OsmStatusChecker when Overpass results arrive.
 * Refreshes the OSM status row on the Signals panel and re-renders the
 * Tags panel so red (OSM-only) rows appear as soon as the Overpass data
 * lands. The per-node TagState is NOT recreated — only the rendering is
 * refreshed around the now-known osmTags.
 */
function _onOsmStatusChange() {
    if (!_isSignalPopupOpen()) return;
    const idRow = _idRow();
    if (idRow) {
        _resetOsmStatus(idRow);
        _applyOsmStatus(idRow, _currentIdx, _feats[_currentIdx]);
    }
    _updateTagsPanel();
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

function _applyOsmStatus(idRow, idx, feat) {
    if (_osmChecker.isChecking(idx)) return; // Keep the default spinner

    idRow.querySelector('.osm-checking')?.classList.add('is-hidden');

    // Helper to display and configure a status element.
    const showTarget = (selector, setupFn = null) => {
        const el = idRow.querySelector(selector);
        if (el) {
            if (setupFn) setupFn(el);
            el.classList.remove('is-hidden');
        }
    };

    if (_osmChecker.isUnsupported(idx) ||
        _osmChecker.isNotInOsm(idx)) {
        showTarget('.osm-locate', el => {
            el.href = `https://www.openstreetmap.org/?mlat=${feat.lat.toFixed(6)}&mlon=${feat.lng.toFixed(6)}&zoom=18`;
        });
    } else if (_osmChecker.isInOsm(idx)) {
        const nodeId = _osmChecker.nodeIdAt(idx);
        showTarget('.osm-in-osm', el => {
            const lbl = t('osm.inOsm', nodeId);
            el.href = `https://www.openstreetmap.org/node/${nodeId}`;
            el.title = lbl;
            el.setAttribute('aria-label', lbl);
        });
    } else if (_osmChecker.isError(idx)) {
        showTarget('.osm-retry');
    }
}


// ===== In-place DOM updates =====

/**
 * Update a nav counter label and control arrow button visibility.
 * Shared by signal navigation (Signals tab) and node navigation (Tags tab) —
 * both display an identical "A / B" counter with prev/next arrow buttons.
 */
function _updateNavCounter(labelEl, prevAction, nextAction, current, total) {
    labelEl.textContent = total > 0 ? t('popup.navLabel', current + 1, total) : '–';
    _popupEl.querySelectorAll(
        `[data-action="${prevAction}"], [data-action="${nextAction}"]`
    ).forEach(btn => btn.classList.toggle('is-hidden', total <= 1));
}

function _updateSignalsPanel() {
    if (!_popupEl) return;
    const s = _feats[_currentIdx];
    const p = s.p;

    _updateSignalNavHeader(p, _feats.length);
    _updateSignalColor(p);
    _updatePinButton();
    _updateDataRows(p);
    _updateNetworkIdRow(s);
    _updateCoords(s);
    _updateNodeBadge();

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
function _updateSignalNavHeader(p, total) {
    _updateNavCounter(
        _popupEl.querySelector('.pu-nav-label'),
        'nav-prev', 'nav-next',
        _currentIdx, total
    );
    _popupEl.querySelector('.pu-row[data-field="signalType"] .pu-badge').textContent =
        p.signalType ?? '';
}

/**
 * Populate all .pu-row[data-field] values from displayProps.
 * signalType, networkId, coords are skipped — each has its own dedicated updater.
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
    _applyOsmStatus(idRow, _currentIdx, s);
}

/** Write the lat/lng coordinate pair to the coords row. */
function _updateCoords(s) {
    _popupEl.querySelector('.pu-row[data-field="coords"] .pu-val').textContent =
        `${s.lat.toFixed(6)}  ${s.lng.toFixed(6)}`;
}

function _updateNodeBadge() {
    // Update the OSM node index associated with the current signal.
    const nodeIdx = _osmChecker.getNodeIdxForSignal(_currentIdx);
    const nodeCount = _osmChecker.getNodeCount();
    const nodeCounter = _popupEl.querySelector('.pu-node-counter');
    if (nodeIdx === undefined || nodeIdx === -1) {
        nodeCounter.textContent = t('popup.nodeNA');
    } else {
        nodeCounter.textContent = t('popup.navLabel', nodeIdx + 1, nodeCount);
        // Sync Tags tab to the node of the currently displayed signal.
        _tagsNodeIdx = nodeIdx;
    }
    _currentNodeIdx = nodeIdx;
}

/** Sync the pin button state with the current signal's pin status. */
function _updatePinButton() {
    const feat = _feats[_currentIdx];
    const networkId = feat?.p?.networkId;
    const pinned = networkId ? isPinned(networkId) : false;
    const label = t(pinned ? 'pinned.unpin' : 'pinned.pin');
    const btn = _popupEl?.querySelector('[data-action="pin"]');
    if (btn) {
        btn.classList.toggle('is-pinned', pinned);
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-pressed', String(pinned));
    }
}


// ===== Tags panel — state accessors =====

/**
 * Get (or lazily create) the TagState for the currently-displayed Tags node.
 * Creating a state the first time a node is shown means edits are preserved
 * when the user navigates away and comes back (until popupclose).
 */
function _currentTagState() {
    return _tagStateFor(_tagsNodeIdx);
}

function _currentAppTags() {
    return _appTagsByNode.get(_tagsNodeIdx) ?? new Map();
}

function _tagStateFor(nodeIdx) {
    let state = _tagStates.get(nodeIdx);
    if (state) return state;

    const node = _osmChecker.getNode(nodeIdx);
    const appTags = node?.tags ?? new Map();
    state = createTargetState(appTags);
    _tagStates.set(nodeIdx, state);
    // Freeze a separate clone so 'undo' is stable even if node.tags were ever
    // mutated somewhere else.
    _appTagsByNode.set(nodeIdx, new Map(appTags));
    return state;
}


// ===== Tags panel — rendering =====

/**
 * Refresh everything inside the OSM Tags tab:
 *   - the node counter (tags-prev / tags-next),
 *   - the tag list for the current node (flat when OSM is unknown,
 *     diff-styled when OSM data is available),
 *   - the footer Copy / JOSM buttons (disabled when target is empty).
 */
function _updateTagsPanel() {
    if (!_popupEl || !_osmChecker) return;

    const total = _osmChecker.getNodeCount();
    const hasNode = total > 0;
    const state = hasNode ? _tagStateFor(_tagsNodeIdx) : null;
    const osmTags = hasNode ? _osmChecker.getOsmTagsForNode(_tagsNodeIdx) : null;
    const hasTarget = state ? state.target.size > 0 : false;

    _updateTagsNav(total);
    _renderTagsList(state, osmTags);
    _updateFooterButtons(hasTarget);
}

function _updateTagsNav(total) {
    _updateNavCounter(
        _popupEl.querySelector('.pu-tags-node-label'),
        'tags-prev', 'tags-next',
        _tagsNodeIdx, total
    );
}

function _updateFooterButtons(hasTarget) {
    _popupEl.querySelector('[data-action="copy"]').disabled = !hasTarget;
    _popupEl.querySelector('[data-action="josm"]').disabled = !hasTarget;
}

/**
 * Render the tag list into .pu-tags-list. Two presentation modes:
 *   - OSM data available (Diff mode) : variant rows + contextmenu handler.
 *   - OSM data unknown                : flat target rows, no menu.
 */
function _renderTagsList(state, osmTags) {
    const list = _popupEl.querySelector('.pu-tags-list');
    list.replaceChildren();

    // Diff mode is active whenever OSM data is available for the current
    // node. Without OSM data we can't compute a divergence so we render a
    // flat list with no menu — same fallback as before, just driven by the
    // data instead of an explicit toggle.
    const diffMode = state !== null && osmTags !== null;

    // Class scopes the interactive affordance (hover/focus ring on rows) to
    // diff mode only.
    list.classList.toggle('is-diff-active', diffMode);

    // Make the list programmatically focusable in diff mode so Ctrl+Z /
    // Ctrl+Y stay live after the user has interacted with a context menu —
    // we restore focus here when a menu item action runs (see _runMenuAction).
    list.tabIndex = diffMode ? -1 : null;

    // Rebind the container-level contextmenu on every render — assigning to
    // .oncontextmenu (rather than addEventListener) keeps a single handler.
    list.oncontextmenu = diffMode ? _onTagsContextMenu : null;

    if (!state) return;

    const rows = diffMode
        ? _buildDiffRows(state.target, computeTagDiff(state.target, osmTags), _currentAppTags())
        : _buildFlatRows(state.target);
    list.append(...rows);
}

/**
 * Diff mode rendering — walk the target in insertion order, then append the
 * OSM-only stale keys at the end.
 *
 *   divergent with non-null OSM value → red(osmVal) + green(targetVal)
 *   divergent with null OSM value     → green(targetVal)     (target-only)
 *   not divergent AND modified        → orange(targetVal)    (merged)
 *   not divergent AND unchanged       → normal(targetVal)
 *   OSM-only appended at end          → red(osmVal)
 */
function _buildDiffRows(target, divergent, appTags) {
    const rows = [];

    // When osmTags was null computeTagDiff returns null — render flat.
    if (!divergent) {
        for (const [k, v] of target) {
            rows.push(_buildRegularRow(k, v, appTags));
        }
        return rows;
    }

    // Pass 1 — target keys in insertion order.
    for (const [k, targetVal] of target) {
        if (divergent.has(k)) {
            rows.push(..._buildConflictRows(k, targetVal, divergent.get(k)));
        } else {
            rows.push(_buildRegularRow(k, targetVal, appTags));
        }
    }

    // Pass 2 — OSM-only (stale) keys appended at the end.
    for (const [k, { expected, actual }] of divergent) {
        if (expected === null) rows.push(_makeRow(k, actual, VARIANT.REMOVED));
    }

    return rows;
}

/** Emit one or two rows for a divergent key — red first (if OSM present), green second. */
function _buildConflictRows(key, targetVal, { actual }) {
    const rows = [];
    if (actual !== null) rows.push(_makeRow(key, actual, VARIANT.REMOVED));
    rows.push(_makeRow(key, targetVal, VARIANT.ADDED));
    return rows;
}

/**
 * Emit a single row for a target key that matches OSM.
 * Key was merged from OSM → orange; key is untouched → normal.
 */
function _buildRegularRow(key, targetVal, appTags) {
    const isModified = appTags.get(key) !== targetVal;
    return _makeRow(key, targetVal, isModified ? VARIANT.MODIFIED : null);
}

/** Flat rendering — target tags only, as normal rows. */
function _buildFlatRows(target) {
    return [...target].map(([k, v]) => _makeRow(k, v, null));
}

/**
 * Build one tag row from the template.
 *   - key/value text (zero-width spaces for soft wrapping),
 *   - optional variant class (see VARIANT),
 *   - data-key / data-variant attributes consumed by the delegated
 *     contextmenu handler to build row-specific actions,
 *   - tabIndex so keyboard users can open the row's context menu
 *     (Shift+F10 / Menu key) — the event bubbles to the container.
 */
function _makeRow(key, value, variant) {
    const row = _tplTagRow().content.cloneNode(true).querySelector('.pu-osm-row');
    if (variant) {
        row.classList.add(variant);
        row.dataset.variant = variant;
    }
    row.dataset.key = key;
    // Zero-width space allows wrapping inside long keys and values.
    row.querySelector('.pu-osm-key').textContent = key.replaceAll(':', '\u200B:');
    row.querySelector('.pu-osm-val').textContent = value.replaceAll(';', ';\u200B');
    row.tabIndex = 0;
    return row;
}


// ===== Unified context menu — diff mode only =====

/**
 * Single contextmenu handler for the tags list. Only attached when Diff
 * mode is active (see _renderTagsList).
 *
 * Item layout:
 *   - Row-specific items     (when the pointer is over a .pu-osm-row)
 *   - [separator]
 *   - Global batch actions   (Merge all, Undo all when target dirty)
 *   - [separator]
 *   - History navigation     (Undo / Redo with Ctrl+Z / Ctrl+Y shortcuts)
 *
 * Each action is wrapped in _runMenuAction() so focus returns to the tags
 * list once the menu closes — keeps Ctrl+Z / Ctrl+Y live without forcing
 * the user to click the list again.
 */
function _onTagsContextMenu(e) {
    e.preventDefault();

    const state = _currentTagState();
    const appTags = _currentAppTags();
    const osmTags = _osmChecker.getOsmTagsForNode(_tagsNodeIdx);
    const row = e.target.closest('.pu-osm-row');

    const items = _buildContextMenuItems(row, state, appTags, osmTags);
    // Nothing to offer (e.g. all merged AND target equals appTags) —
    // suppress the menu entirely rather than showing an empty floater.
    if (items.length === 0) return;
    _openContextMenuAt(e, items, row ?? _popupEl.querySelector('.pu-tags-list'));
}

/**
 * Wrap a mutation action so it runs the data change, refreshes the panel,
 * and restores focus on .pu-tags-list. This is what keeps Ctrl+Z / Ctrl+Y
 * working after a context-menu interaction — without this, focus stays in
 * the (now-removed) menu and the popup-level keydown listener stops seeing
 * keyboard events.
 *
 * @param {() => boolean} fn  Mutation function that returns true on change.
 */
function _runMenuAction(fn) {
    return () => {
        const changed = fn();
        if (changed) _updateTagsPanel();
        // Restore focus regardless of whether anything changed — the menu
        // had focus and we must hand it back so the popup keydown handler
        // keeps receiving Ctrl+Z / Ctrl+Y.
        _popupEl?.querySelector('.pu-tags-list')?.focus();
    };
}

/**
  * Assemble the full item list: row items (when on a row) → batch actions.
 *   - 'Merge all' is offered only when at least one OSM key would change the target.
 *   - 'Undo all'  is offered only when the target has any pending change vs. appTags.
 * Both checks are independent — either, both, or none can be present.
*/
function _buildContextMenuItems(row, state, appTags, osmTags) {
    const items = [];

    // Row-specific actions
    const rowItems = row ? _rowMenuItems(row, state, appTags, osmTags) : [];
    if (rowItems.length) {
        items.push(...rowItems, 'separator');
    }

    // Global batch actions
    if (_canMergeAll(state, osmTags)) {
    items.push({
        labelKey: 'context.mergeAll',
        action: _runMenuAction(() => mergeAll(state, osmTags)),
    });
}

    if (_isTargetDirty(state, appTags)) {
        items.push({
            labelKey: 'context.undoAll',
            action: _runMenuAction(() => undoAll(state, appTags)),
        });
    }

    return items;
}

/**
 * Whether 'Merge all' would change anything: true iff at least one in-scope
 * OSM key has a value that differs from the target. Reuses computeTagDiff()
 * so the predicate stays consistent with what the row colors show.
 */
function _canMergeAll(state, osmTags) {
    if (!osmTags) return false;
    const diff = computeTagDiff(state.target, osmTags);
    if (!diff) return false;
    // 'actual' is null only for target-only keys (green rows). Those don't
    // get merged — we need at least one entry where OSM has a value.
    for (const { actual } of diff.values()) {
        if (actual !== null) return true;
    }
    return false;
}

/**
 * Check whether the target contains modifications compared to the original app tags.
 * Used to determine whether to display "Undo all" only when relevant.
 */
function _isTargetDirty(state, appTags) {
    if (state.target.size !== appTags.size) return true;
    for (const [k, v] of state.target) {
        if (appTags.get(k) !== v) return true;
    }
    return false;
}

/**
 * Row-specific menu items, dispatched on the row's variant.
 *   - diff-removed  (red)    → Merge  (write OSM value into target).
 *   - diff-modified (orange) → Undo   (restore app value).
 *   - diff-added    (green)  → no menu item: green rows are intentional
 *                              app-generated values that complement or
 *                              override OSM — nothing to roll back.
 *   - normal rows            → no items.
 */
function _rowMenuItems(row, state, appTags, osmTags) {
    const key = row.dataset.key;
    const variant = row.dataset.variant;
    if (!key) return [];

    switch (variant) {
        case VARIANT.REMOVED: return _mergeItem(key, state, osmTags);
        case VARIANT.MODIFIED: return _undoItem(key, state, appTags);
        default: return [];
    }
}

/** Build the 'Merge' item for a red row — noop when the OSM value is unknown. */
function _mergeItem(key, state, osmTags) {
    const osmVal = osmTags?.[key];
    if (osmVal === undefined) return [];
    return [{
        labelKey: 'context.merge',
        action: _runMenuAction(() => merge(state, key, osmVal)),
    }];
}

/** Build the 'Undo' item for an orange row — noop when unchanged. */
function _undoItem(key, state, appTags) {
    if (!_isKeyModified(state, appTags, key)) return [];
    return [{
        labelKey: 'context.undo',
        action: _runMenuAction(() => undo(state, key, appTags)),
    }];
}

/**
 * True when the target value for 'key' differs from the appTags value:
 *   - key in appTags  → values differ
 *   - key in target but not appTags → was merged from OSM-only
 */
function _isKeyModified(state, appTags, key) {
    const inApp = appTags.has(key);
    if (inApp) return appTags.get(key) !== state.target.get(key);
    return state.target.has(key);
}

/**
 * Open the context menu at pointer coordinates, falling back to the element's
 * bounding rect when the event was triggered by keyboard (Shift+F10 / Menu
 * key) — some browsers report 0/0 for keyboard-triggered contextmenu events.
 */
function _openContextMenuAt(e, items, fallbackEl) {
    let x = e.clientX;
    let y = e.clientY;
    if (x === 0 && y === 0 && fallbackEl instanceof Element) {
        const r = fallbackEl.getBoundingClientRect();
        x = r.left + Math.min(r.width / 2, 16);
        y = r.top + r.height / 2;
    }
    showContextMenu(x, y, items);
}


// ===== Tab management =====

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


// ===== Click handler =====

/** Step the current signal index by delta (-1 or +1), wrapping around. */
function _navigateSignal(delta) {
    if (_feats.length <= 1) return;
    _currentIdx = (_currentIdx + delta + _feats.length) % _feats.length;
    _updateSignalsPanel();
    _updateTagsPanel();
}

/** Step the tags node index by delta (-1 or +1), wrapping around. */
function _navigateNode(delta) {
    const nodeCount = _osmChecker.getNodeCount();
    _tagsNodeIdx = (_tagsNodeIdx + delta + nodeCount) % nodeCount;
    _updateTagsPanel();
}

function _onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();

    switch (btn.dataset.action) {

        case 'pin': {
            const networkId = _feats?.[_currentIdx]?.p?.networkId;
            if (networkId) togglePin(networkId);
            break;
        }

        case 'close':
            _popup?.remove(); // triggers popupclose → closeSignalPopup()
            break;

        case 'help':
            openHelpPage('popup');
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
            _copyTags(btn);
            break;

        case 'josm':
            _sendToJOSM(btn);
            break;

        case 'osm-retry':
            _osmChecker?.retry();
            break;
    }
}


// ===== Export actions — operate on the current TARGET, not on node.tags =====

/**
 * Sort the target tag entries lexicographically by key. Auxiliary keys like
 * 'ref' and 'source' end up at the end of an OSM-style hierarchical layout
 * (railway* → ref → source...). Returns a new array, doesn't mutate the Map.
 */
function _sortedTagEntries(target) {
    return [...target.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function _copyTags(btn) {
    const state = _currentTagState();
    if (!state?.target.size) return;
    _osmChecker?.invalidate();
    const text = _sortedTagEntries(state.target)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    navigator.clipboard.writeText(text)
        .then(() => _flash(btn))
        .catch(() => prompt(t('popup.copyPrompt'), text));
}

async function _sendToJOSM(btn) {
    const state = _currentTagState();
    if (!state?.target.size) return;
    if (btn.disabled) return;

    if (!getSkipJosmConfirm() && _osmChecker?.hasAnyInOsm()) {
        const msg = _feats.length > 1 ? t('osm.warnMulti') : t('osm.warnSingle');
        if (!confirm(msg)) return;
    }

    // Disable the button while the request is pending.
    btn.disabled = true;

    // Small lat offset per node so separately created nodes don't overlap in JOSM.
    const node = _osmChecker.getNode(_tagsNodeIdx);
    const lat = _latlng[0] + (node?.index ?? _tagsNodeIdx) * 0.00001;
    const sortedTags = new Map(_sortedTagEntries(state.target));

    try {
        await josmAddNode([lat, _latlng[1]], sortedTags);
        _osmChecker?.invalidate();
        _flash(btn);
    } catch (err) {
        console.warn('[JOSM]', err.message);
        const msg = err.message.includes('JOSM')
            ? err.message
            : t('josm.notReachable', err.message);
        alert(msg);
    } finally {
        btn.disabled = false;
    }
}

function _flash(btn) {
    if (!btn) return;
    if (btn._flashTimer) clearTimeout(btn._flashTimer);
    btn.classList.add('is-flash');
    btn._flashTimer = setTimeout(() => {
        btn.classList.remove('is-flash');
        btn._flashTimer = null;
    }, 2400);
}


// ===== Accessibility =====

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
    popupEl.addEventListener('keydown', _onKeydown);
}

/**
 * Popup-level keydown router. Delegates to specialised helpers so each
 * concern stays focused:
 *   - Escape           → close the popup
 *   - ?                → open help page
 *   - Ctrl+Z / Ctrl+Y  → history navigation (Tags tab + OSM data only)
 *   - Ctrl+C / Ctrl+O  → copy tags / open in JOSM (Tags tab only)
 *   - ArrowLeft/Right  → navigate between co-located signals
 *   - Tab / Shift+Tab  → focus trap inside the popup
 */
function _onKeydown(e) {
    if (_handleNavBarShortcuts(e)) return;
    if (_handleHistoryShortcut(e)) return;
    if (_handleExportShortcut(e)) return;
    if (_handleArrows(e)) return;
    _handleFocusTrap(e);
}

/**
 * Escape closes the popup. context-menu.js is expected to trap Escape
 * itself when a menu is open; if it isn't open, this just closes the popup.
 */
function _handleNavBarShortcuts(e) {
    if (e.key === 'Escape') {
        e.stopPropagation();
        _popup?.remove();
        return true;
    }
    if (e.key === '?') {
        // Open the popup help page.
        e.stopPropagation();
        openHelpPage('popup');
        return true;
    }
    return false;
}

/**
 * Ctrl+Z / Ctrl+Y on the Tags tab in Diff mode walks the per-node undo/redo
 * stack. Active only on the Tags tab when OSM data is loaded — i.e. when
 * the menu can actually mutate the target. Otherwise leaves Ctrl+Z alone
 * for the browser (e.g. text selection).
 *
 * Returns true when the key was handled so the caller can stop further
 * processing.
 */
function _handleHistoryShortcut(e) {
    if (_activeTab !== TAB_TAGS) return false;
    if (!_osmChecker?.getOsmTagsForNode(_tagsNodeIdx)) return false;
    if (!(e.ctrlKey || e.metaKey)) return false;

    const isUndo = (e.key === 'z' || e.key === 'Z') && !e.shiftKey;
    const isRedo = (e.key === 'y' || e.key === 'Y');
    if (!isUndo && !isRedo) return false;

    e.preventDefault();
    e.stopPropagation();
    const state = _currentTagState();
    const changed = isUndo ? undoHistory(state) : redoHistory(state);
    if (changed) _updateTagsPanel();
    // Return focus to the list so a follow-up Ctrl+Z still routes here.
    _popupEl?.querySelector('.pu-tags-list')?.focus();
    return true;
}

/**
 * Ctrl+C → Copy tags, Ctrl+O → Open in JOSM.
 * Active only on the Tags tab so they never shadow the browser defaults
 * on other tabs. Retrieves the footer button for the flash animation.
 */
function _handleExportShortcut(e) {
    if (_activeTab !== TAB_TAGS) return false;
    if (!(e.ctrlKey || e.metaKey)) return false;

    const isCopy = (e.key === 'c' || e.key === 'C');
    const isJosm = (e.key === 'o' || e.key === 'O');
    if (!isCopy && !isJosm) return false;

    e.preventDefault();
    e.stopPropagation();

    const action = isCopy ? 'copy' : 'josm';
    const btn = _popupEl?.querySelector(`[data-action="${action}"]`);
    if (!btn || btn.disabled) return true;

    if (isCopy) _copyTags(btn);
    else _sendToJOSM(btn);
    return true;
}

function _getNavigationDelta(e) {
    if (e.key === 'ArrowLeft') return -1;
    if (e.key === 'ArrowRight') return 1;
    return 0;
}

/**
 * ArrowLeft / ArrowRight step between co-located signals (Signals tab)
 * or signal nodes (Tags tab). */
function _handleArrows(e) {
    const delta = _getNavigationDelta(e);
    if (delta === 0) return false;

    e.stopPropagation();
    e.preventDefault();

    if (_activeTab === TAB_TAGS) {
        // Step between signal nodes.
        _navigateNode(delta);
    } else {
        // Step between co-located signals.
        _navigateSignal(delta);
    }
    return true;
}

/** Trap Tab / Shift+Tab inside the popup so focus never escapes to the map. */
function _handleFocusTrap(e) {
    if (e.key !== 'Tab') return;
    const focusable = [..._popupEl.querySelectorAll(
        'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'
    )].filter(n => !n.closest('.is-hidden'));
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

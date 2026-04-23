/**
 * signal-popup.js — Unified signal popup with two tabs.
 *
 * Tab "Signals" — SNCF open data fields for the current signal,
 *                 OSM existence check per signal, Signal Node counter.
 * Tab "OSM Tags" — generated OSM tags for the current node,
 *                  OSM diff toggle (GitHub-style) when divergences exist,
 *                  Copy tags and Open in JOSM actions.
 *
 * A single Leaflet popup is opened and its content updated in-place on
 * every navigation / tab switch.
 *
 * NOTE — unfiltered features:
 *   openSignalPopup() always receives the COMPLETE set of co-located features
 *   (group.all from the worker). Filters control marker visibility only.
 *
 * Public API:
 *   openSignalPopup(latlng, feats, idx?, startTab?)
 */

import { map } from './map.js';
import { getTypeColor, sortSignalsByNetworkId } from './signal-mapping.js';
import { t, translateElement, onLangChange } from './translation.js';
import { OsmStatusChecker } from './osm-checker.js';
import { josmAddNode } from './josm.js';
import { getLineLabel, getBlockType } from './block-system.js';
import { getSkipJosmConfirm, getAutoTagsTab } from './prefs.js';
import { isPinned, togglePin, onPinsChange } from './pins.js';
import { computeTagDiff } from './osm-diff.js';

let _unsubscribePins = null;

// ===== Template accessor =====

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


// ===== Module state =====

let _popup = null;        // Leaflet popup instance
let _popupEl = null;      // live .pu-wrap DOM node
let _feats = null;
let _latlng = null;
let _osmChecker = null;
let _preFocusEl = null;   // element that had focus before the popup opened
let _currentIdx = 0;      // index of the signal shown in the Signals tab
let _currentNodeIdx = -1; // node index of the currently displayed signal
let _tagsNodeIdx = 0;     // node index shown in the OSM Tags tab
let _activeTab = TAB_SIGNALS;
let _diffActive = false;  // OSM diff toggle state — resets on each popup open


// ===== Language change handling =====

// Re-translate all dynamic popup content when the language changes.
// Both panels must be refreshed: Signals for direction/placement values,
// Tags for the node counter label.
// Guard: no-op when no popup is open.
onLangChange(() => {
    if (_isSignalPopupOpen()) {
        _updateSignalsPanel();
        _updateTagsPanel();
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
    // Initialize module state.
    _latlng = latlng;
    _currentIdx = idx;
    _tagsNodeIdx = 0;
    _currentNodeIdx = -1;
    _diffActive = false;

    // Save focus origin so it can be restored when the popup closes.
    _preFocusEl = document.activeElement;

    // Sort co-located signals by networkId in ascending numeric order so that
    // the prev/next navigation follows a predictable logical sequence.
    _feats = sortSignalsByNetworkId(feats);
    _initOsmChecker(_feats);

    // Build the popup content and open it on the map.
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

    // Restore focus to the marker (or whatever had focus) before the popup opened.
    _preFocusEl?.focus();
    _preFocusEl = null;
}


// ===== Initialization =====

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
 * Tags panel so the diff toggle can appear / disappear as results arrive.
 */
function _onOsmStatusChange() {
    if (!_popup?.isOpen() || !_popupEl) return;
    const idRow = _idRow();
    if (idRow) {
        _resetOsmStatus(idRow);
        _applyOsmStatus(idRow, _currentIdx, _feats[_currentIdx]);
    }
    // OSM tags feed the diff toggle and diff rows — refresh the Tags panel too.
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

    // Helper to display and configure a status element
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
 *
 * @param {Element} labelEl    — The <span> showing the counter.
 * @param {string}  prevAction — data-action value of the previous button.
 * @param {string}  nextAction — data-action value of the next button.
 * @param {number}  current    — Zero-based current index.
 * @param {number}  total      — Total item count (0 renders '–').
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
    _applyOsmStatus(idRow, _currentIdx, s);
}

/** Write the lat/lng coordinate pair to the coords row. */
function _updateCoords(s) {
    _popupEl.querySelector('.pu-row[data-field="coords"] .pu-val').textContent =
        `${s.lat.toFixed(6)}  ${s.lng.toFixed(6)}`;
}

function _updateNodeBadge() {
    // Update the OSM node index associated with the current signal
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

/**
 * Update every element in the OSM Tags tab panel for _tagsNodeIdx.
 * Does not touch the Signals panel.
 *
 * The OSM diff toggle button is shown only when the node's OSM tags differ
 * from the app-generated tags. When active, the tag list is rendered in
 * GitHub-style with removed/added rows; otherwise the normal list is shown.
 */
function _updateTagsPanel() {
    if (!_popupEl || !_osmChecker) return;

    const total = _osmChecker.getNodeCount();
    const node = total > 0 ? _osmChecker.getNode(_tagsNodeIdx) : null;
    const hasNode = node?.tags?.size > 0;
    const osmTags = _osmChecker.getOsmTagsForNode(_tagsNodeIdx);
    const divergent = computeTagDiff(node?.tags, osmTags);
    const hasDiff = divergent !== null;

    _updateTagsNav(total);
    _updateDiffButton(hasDiff);
    _renderTagsList(node, divergent);
    _updateFooterButtons(hasNode);
}

function _updateTagsNav(total) {
    _updateNavCounter(
        _popupEl.querySelector('.pu-tags-node-label'),
        'tags-prev', 'tags-next',
        _tagsNodeIdx, total
    );
}

/** Sync the diff toggle button visibility and active state with current diff data. */
function _updateDiffButton(hasDiff) {
    const btn = _popupEl.querySelector('[data-action="toggle-diff"]');
    if (!btn) return;
    btn.classList.toggle('is-hidden', !hasDiff);
    const active = _diffActive && hasDiff;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    // Title/aria-label reflect the next action the button will trigger.
    const label = t(active ? 'osm.diffHide' : 'osm.diffShow');
    btn.title = label;
    btn.setAttribute('aria-label', label);
}

function _updateFooterButtons(hasNode) {
    _popupEl.querySelector('[data-action="copy"]').disabled = !hasNode;
    _popupEl.querySelector('[data-action="josm"]').disabled = !hasNode;
}

/** Tag list rendering — full switch between normal and diff modes. */
function _renderTagsList(node, divergent) {
    const list = _popupEl.querySelector('.pu-tags-list');
    list.replaceChildren();
    if (!node?.tags?.size) return;
    const hasDiff = divergent !== null;
    const frag = (_diffActive && hasDiff)
        ? _renderDiffList(node.tags, divergent)
        : _renderNormalList(node.tags);
    list.appendChild(frag);
}

/**
 * Render the tag list in GitHub-style diff mode.
 *
 * Order preserves the natural insertion order of `generated`:
 *   - unchanged keys render as a single normal row,
 *   - mismatched keys render as (removed OSM row, added generated row),
 *   - keys generated but missing in OSM render as a single added row,
 *   - keys only present in OSM (stale) are appended last as removed rows.
 */
function _renderDiffList(generated, divergent) {
    const frag = document.createDocumentFragment();

    // Pass 1 — iterate generated in its natural insertion order.
    for (const [k, expected] of generated) {
        if (divergent.has(k)) {
            const { actual } = divergent.get(k);
            if (actual !== null) frag.appendChild(_makeTagRow(k, actual, 'diff-removed'));
            frag.appendChild(_makeTagRow(k, expected, 'diff-added'));
        } else {
            frag.appendChild(_makeTagRow(k, expected));
        }
    }

    // Pass 2 — stale OSM-only keys appended at the end.
    for (const [k, { expected, actual }] of divergent) {
        if (expected === null) frag.appendChild(_makeTagRow(k, actual, 'diff-removed'));
    }

    return frag;
}

/** Render the generated tag list as-is, in insertion order. */
function _renderNormalList(generated) {
    const frag = document.createDocumentFragment();
    for (const [k, v] of generated) frag.appendChild(_makeTagRow(k, v));
    return frag;
}


/**
 * Build one tag row from the template. Optional variant adds a diff class
 * ('diff-removed' / 'diff-added'); CSS handles the +/− prefix via ::before.
 */
function _makeTagRow(key, value, variant = null) {
    const row = _tplTagRow().content.cloneNode(true).querySelector('.pu-osm-row');
    if (variant) row.classList.add(variant);
    // Zero-width space allows wrapping in long OSM keys or values.
    row.querySelector('.pu-osm-key').textContent = key.replaceAll(':', '\u200B:');
    row.querySelector('.pu-osm-val').textContent = value.replaceAll(';', ';\u200B');
    return row;
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
    _currentIdx = (_currentIdx + delta + _feats.length) % _feats.length;
    _updateSignalsPanel();
    _updateTagsPanel();
}


/** Step the tags node index by delta (-1 or +1), wrapping around. */
function _navigateNode(delta) {
    let nodeCount = _osmChecker.getNodeCount();
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
            if (networkId) {
                togglePin(networkId);
            }
            break;
        }

        case 'close':
            _popup?.remove(); // triggers popupclose → closeSignalPopup()
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

        case 'toggle-diff':
            _diffActive = !_diffActive;
            _updateTagsPanel();
            break;

        case 'copy':
            _copyTags(_osmChecker.getNode(_tagsNodeIdx), btn);
            break;

        case 'josm':
            _sendToJOSM(_osmChecker.getNode(_tagsNodeIdx), btn);
            break;

        case 'osm-retry':
            _osmChecker?.retry();
            break;
    }
}


// ===== Actions =====

function _copyTags(node, btn) {
    if (!node?.tags?.size) return;
    _osmChecker?.invalidate();
    const text = [...node.tags.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
    navigator.clipboard.writeText(text)
        .then(() => _flash(btn))
        .catch(() => prompt(t('popup.copyPrompt'), text));
}

async function _sendToJOSM(node, btn) {
    if (!node?.tags?.size) return;
    if (btn.disabled) return;

    if (!getSkipJosmConfirm() && _osmChecker?.hasAnyInOsm()) {
        const msg = _feats.length > 1 ? t('osm.warnMulti') : t('osm.warnSingle');
        if (!confirm(msg)) return;
    }

    // Disable the button while the request is pending.
    btn.disabled = true;

    // Small lat offset per node so separately created nodes don't overlap in JOSM.
    const lat = _latlng[0] + node.index * 0.00001;

    try {
        await josmAddNode([lat, _latlng[1]], node.tags);
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
    popupEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            _popup?.remove(); // triggers popupclose → closeSignalPopup()
            return;
        }

        // Arrow left/right navigate signals when multiple are present.
        if (_feats.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.stopPropagation();
            e.preventDefault();
            _currentIdx = (_currentIdx + (e.key === 'ArrowRight' ? 1 : -1) + _feats.length) % _feats.length;
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
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });
}

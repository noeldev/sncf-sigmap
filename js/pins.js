/**
 * pins.js — Pinned signal management.
 *
 * Allows the user to bookmark specific signals by Network ID for quick
 * map navigation. Pins persist across sessions via prefs.js.
 *
 * Public API:
 *   initPins(opts)       — create the panel and wire it into the sidebar.
 *   isPinned(networkId)  — return true when the signal is currently pinned.
 *   togglePin(networkId) — add or remove a pin; triggers a panel refresh.
 *   flashPinned(msg)     — show a brief overlay message (e.g. "Pinned!").
 */

import { t, translateElement, onLangChange } from './translation.js';
import { savePins, loadPins } from './prefs.js';
import { flyToLocation } from './map.js';
import { getSignalLatlng } from './map-layer.js';
import { fetchTileByKey, findSignalLocation } from './tiles.js';
import { showFlash } from './progress.js';
import { PillList } from './ui/pill-list.js';


/* ===== Module state ===== */

/** Ordered array of pinned Network IDs — insertion order preserved. */
let _pins = [];

/** Map from networkId → tileKey — populated from the filter index at init. */
let _networkIdToTile = new Map();

/** PillList instance for the pinned panel. */
let _pillList = null;

/** Root section element of the pinned panel. */
let _sectionEl = null;

/** Callback to fire when pins change (e.g. to re-render pin button states). */
let _onPinsChange = null;


/* ===== Public API ===== */

/**
 * Initialize the pinned signals panel in the sidebar.
 * @param {object}   opts
 * @param {Element}  opts.container        — Element to append the panel to.
 * @param {Map}      opts.networkIdToTile  — networkId → tileKey map from filters.js.
 * @param {Function} [opts.onChange]       — Called after any pin change.
 */
export function initPins({ container, networkIdToTile, onChange }) {
    _networkIdToTile = networkIdToTile;
    _onPinsChange    = onChange ?? null;
    _pins            = loadPins();

    _buildPanel(container);
    onLangChange(() => _renderPanel());
}

/**
 * Return true when the given Network ID is currently pinned.
 * @param {string} networkId
 * @returns {boolean}
 */
export function isPinned(networkId) {
    return _pins.includes(networkId);
}

/**
 * Add or remove a pin for the given Network ID.
 * Persists the updated list and refreshes the panel.
 * @param {string} networkId
 */
export function togglePin(networkId) {
    const idx = _pins.indexOf(networkId);
    if (idx >= 0) {
        _pins.splice(idx, 1);
    } else {
        _pins.push(networkId);
    }
    savePins(_pins);
    _renderPanel();
    _onPinsChange?.();
}

/**
 * Show a brief status message using the progress overlay.
 * Auto-hides after 1.5 s.
 * @param {string} msg
 */
export function flashPinned(msg) {
    showFlash(msg);
}


/* ===== Panel build / render ===== */

function _buildPanel(container) {
    const tpl = document.getElementById('tpl-pinned-section');
    const section = tpl.content.cloneNode(true).querySelector('.pinned-section');
    translateElement(section);

    section.querySelector('[data-action="clear-pins"]').addEventListener('click', _onClearAll);

    container.appendChild(section);
    _sectionEl = section;

    _pillList = new PillList({
        containerEl: section.querySelector('.pinned-tags'),
        template: document.getElementById('tpl-filter-tag'),
        onRemove: networkId => togglePin(networkId),
        onLabelClick: networkId => _flyToPin(networkId),
    });

    _renderPanel();
}

/** Rebuild pill list from current _pins. */
function _renderPanel() {
    if (!_pillList) return;
    _pillList.render(_pins);

    // Show hint when list is empty
    const hint = _sectionEl?.querySelector('.pinned-hint');
    if (hint) hint.classList.toggle('is-hidden', _pins.length > 0);
}

function _onClearAll() {
    if (_pins.length === 0) return;
    if (!confirm(t('pinned.confirmClear'))) return;
    _pins = [];
    savePins(_pins);
    _renderPanel();
    _onPinsChange?.();
}


/* ===== Navigation ===== */

async function _flyToPin(networkId) {
    // Fast path: signal is currently rendered in the viewport.
    const rendered = getSignalLatlng(networkId);
    if (rendered) {
        flyToLocation(rendered);
        return;
    }
    // Slow path: fetch tile from cache to get exact coordinates.
    const tileKey = _networkIdToTile.get(networkId);
    if (!tileKey) return;
    const signals = await fetchTileByKey(tileKey);
    const loc     = findSignalLocation(signals, networkId);
    if (loc) flyToLocation(loc);
}

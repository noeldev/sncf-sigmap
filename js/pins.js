/**
 * pins.js — Pinned signal management.
 *
 * Allows the user to bookmark specific signals by Network ID for quick
 * map navigation. Pins persist across sessions via prefs.js.
 *
 * Clipboard integration:
 *   A chevron button in the pinned panel header opens a context menu via
 *   clipboard.js buildTagMenu(). The dataType is FIELD.NETWORK_ID, which is
 *   compatible with the Network ID filter panel — values can be exchanged
 *   between the two without any format conversion.
 *
 * Public API:
 *   initPins(container)  — create the panel and wire it into the sidebar.
 *   isPinned(networkId)  — return true when the signal is currently pinned.
 *   togglePin(networkId) — add or remove a pin; triggers a panel refresh.
 *   onPinsChange(fn)     — register a callback invoked after any pin change.
 */

import { t, translateElement, onLangChange } from './translation.js';
import { FIELD } from './field-keys.js';
import { savePins, loadPins } from './prefs.js';
import { flyToSignal } from './map-layer.js';
import { TagList } from './ui/tag-list.js';
import { buildTagMenu, handleTagsKeydown } from './clipboard.js';
import { Observable } from './utils/observable.js';


// ===== Module state =====

/** Ordered array of pinned Network IDs — insertion order preserved. */
let _pins = [];

/** TagList instance for the pinned panel. */
let _tagList = null;

/** Root section element of the pinned panel. */
let _sectionEl = null;

/** Menu button in the pinned panel summary. */
let _menuBtn = null;

/** Observable for pin changes */
const _pinsChange = new Observable();


// ===== Public API =====

/**
 * Initialize the pinned signals panel in the sidebar.
 * Subscribe to pin changes via onPinsChange() after initialisation.
 *
 * @param {HTMLElement} container — Element to append the panel to.
 */
export function initPins(container) {
    _pins = loadPins();
    _buildPanel(container);
    _bindEvents();
}

/**
 * Register a callback invoked after any pin change.
 * @param {Function} fn
 */
export function onPinsChange(fn) {
    return _pinsChange.subscribe(fn);
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
 * Toggle the pinned state of a signal.
 * @param {string} networkId
 * @returns {boolean} True if the signal is now pinned, false if unpinned.
 */
export function togglePin(networkId) {
    const idx = _pins.indexOf(networkId);
    const pinned = idx === -1;

    if (!pinned) {
        _pins.splice(idx, 1);
    } else {
        _pins.push(networkId);
    }

    savePins(_pins);
    _renderPanel();
    _pinsChange.notify();

    return pinned;
}


// ===== Private helpers =====

function _buildPanel(container) {
    const tpl = document.getElementById('tpl-pinned-section');
    const section = tpl.content.cloneNode(true).querySelector('.pinned-section');
    translateElement(section);

    container.appendChild(section);
    _sectionEl = section;

    _tagList = new TagList({
        containerEl: section.querySelector('.pinned-tags'),
        template: document.getElementById('tpl-filter-tag'),
        onRemove: networkId => togglePin(networkId),
        onLabelClick: networkId => flyToSignal(networkId),
    });

    // The menu button lives in the static #pinned-panel summary (index.html).
    _menuBtn = document.querySelector('#pinned-panel [data-action="pins-menu"]');

    _renderPanel();
}

function _bindEvents() {
    _menuBtn?.addEventListener('click', () => {
        buildTagMenu(_menuBtn, {
            dataType: FIELD.NETWORK_ID,
            getValues: () => [..._pins],
            onDelete: _onDelete,
            onPaste: _onPaste,
        });
    });

    // Keyboard shortcuts on the pinned tags container — mirror context menu.
    _sectionEl?.querySelector('.pinned-tags')
        ?.addEventListener('keydown', e => {
            handleTagsKeydown(e, {
                dataType: FIELD.NETWORK_ID,
                getValues: () => [..._pins],
                onDelete: _onDelete,
                onPaste: _onPaste,
            });
        });

    onLangChange(() => _renderPanel());
}

/** Rebuild tag list from current _pins. */
function _renderPanel() {
    if (!_tagList) return;
    _tagList.render(_pins);
    _sectionEl?.querySelector('.empty-state')?.classList.toggle('is-hidden', _pins.length > 0);
}

/**
 * Delete all pins after user confirmation.
 * Renamed from _onClearAll to match the Delete menu item semantics.
 */
function _onDelete() {
    if (_pins.length === 0) return;
    if (!confirm(t('pinned.confirmClear'))) return;
    _pins = [];
    savePins(_pins);
    _renderPanel();
    _pinsChange.notify();
}

/**
 * Apply pasted Network IDs to the pins list.
 * Passed as a named callback to buildTagMenu and handleTagsKeydown so the
 * logic is defined once and not duplicated between the two call sites.
 * Receives already-deduplicated values from clipboard.js readNewValues().
 * @param {string[]} newVals
 */
function _onPaste(newVals) {
    _pins.push(...newVals);
    savePins(_pins);
    _renderPanel();
    _pinsChange.notify();
}

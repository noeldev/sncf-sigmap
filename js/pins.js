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
 */

import { t, translateElement, onLangChange } from './translation.js';
import { savePins, loadPins } from './prefs.js';
import { flyToSignal } from './filters.js';
import { showFlash } from './progress.js';
import { PillList } from './ui/pill-list.js';


/* ===== Module state ===== */

/** Ordered array of pinned Network IDs — insertion order preserved. */
let _pins = [];

/** PillList instance for the pinned panel. */
let _pillList = null;

/** Root section element of the pinned panel. */
let _sectionEl = null;

/** Clear-all button in the pinned panel summary. */
let _clearBtn = null;

/** Callback to fire when pins change (e.g. to re-render pin button states). */
let _onPinsChange = null;


/* ===== Public API ===== */

/**
 * Initialize the pinned signals panel in the sidebar.
 * @param {object}   opts
 * @param {Element}  opts.container        — Element to append the panel to.
 * @param {Function} [opts.onChange]       — Called after any pin change.
 */
export function initPins({ container, onChange }) {
    _onPinsChange    = onChange ?? null;
    _pins            = loadPins();

    _buildPanel(container);
    // Wire the clear button inside the pinned panel header.
    // Use event delegation on the panel's summary rather than a static id.
    document.getElementById('pinned-panel')
        ?.querySelector('[data-action="clear-pins"]')
        ?.addEventListener('click', e => { e.stopPropagation(); _onClearAll(); });
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
 * Toggle the pinned state of a signal.
 * @param {string} networkId
 * @returns {boolean} True if the signal is now pinned, false if unpinned.
 */
export function togglePin(networkId) {
    const idx = _pins.indexOf(networkId);
    const pinned = idx === -1; // If not found, we are about to pin it

    if (!pinned) {
        _pins.splice(idx, 1);
    } else {
        _pins.push(networkId);
    }

    savePins(_pins);
    _renderPanel();
    _onPinsChange?.();

    return pinned;
}


/* ===== Panel build / render ===== */

function _buildPanel(container) {
    const tpl = document.getElementById('tpl-pinned-section');
    const section = tpl.content.cloneNode(true).querySelector('.pinned-section');
    translateElement(section);

    container.appendChild(section);
    _sectionEl = section;

    _pillList = new PillList({
        containerEl: section.querySelector('.pinned-tags'),
        template: document.getElementById('tpl-filter-tag'),
        onRemove: networkId => togglePin(networkId),
        onLabelClick: networkId => flyToSignal(networkId),
    });

    // Cache the clear button reference — it lives in the static #pinned-panel
    // summary (index.html), not in the cloned template section.
    _clearBtn = document.querySelector('#pinned-panel [data-action="clear-pins"]');

    _renderPanel();
}

/** Rebuild pill list from current _pins. */
function _renderPanel() {
    if (!_pillList) return;
    _pillList.render(_pins);

    // Show empty state when list is empty
    _sectionEl?.querySelector('.empty-state')
        ?.classList.toggle('is-hidden', _pins.length > 0);

    // Clear button is only useful when there are pins to clear
    if (_clearBtn) _clearBtn.classList.toggle('is-hidden', _pins.length === 0);
}

function _onClearAll() {
    if (_pins.length === 0) return;
    if (!confirm(t('pinned.confirmClear'))) return;
    _pins = [];
    savePins(_pins);
    _renderPanel();
    _onPinsChange?.();
}

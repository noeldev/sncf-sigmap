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
import { flyToSignal } from './map-layer.js';
import { TagList } from './ui/tag-list.js';


// ===== Module state =====

/** Ordered array of pinned Network IDs — insertion order preserved. */
let _pins = [];

/** TagList instance for the pinned panel. */
let _tagList = null;

/** Root section element of the pinned panel. */
let _sectionEl = null;

/** Clear-all button in the pinned panel summary. */
let _clearBtn = null;

/** Callback to fire when pins change (e.g. to re-render pin button states). */
let _onPinsChange = null;


// ===== Public API =====

/**
 * Initialize the pinned signals panel in the sidebar.
 * @param {object}   opts
 * @param {Element}  opts.container        — Element to append the panel to.
 * @param {Function} [opts.onChange]       — Called after any pin change.
 */
export function initPins({ container, onChange }) {
    _onPinsChange = onChange ?? null;
    _pins = loadPins();

    _buildPanel(container);
    document.getElementById('pinned-panel')
        ?.querySelector('[data-action="clear-pins"]')
        ?.addEventListener('click', e => {
            e.stopPropagation();
            _onClearAll();
        });
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
    const pinned = idx === -1;

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


// ===== Panel build / render =====

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

    // Cache the clear button reference — it lives in the static #pinned-panel
    // summary (index.html), not in the cloned template section.
    _clearBtn = document.querySelector('#pinned-panel [data-action="clear-pins"]');

    _renderPanel();
}

/** Rebuild tag list from current _pins. */
function _renderPanel() {
    if (!_tagList) return;
    _tagList.render(_pins);

    _sectionEl?.querySelector('.empty-state')
        ?.classList.toggle('is-hidden', _pins.length > 0);

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

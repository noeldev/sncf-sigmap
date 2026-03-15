/**
 * tags-popup.js — OSM tags preview popup.
 *
 * Completely decoupled from signal-popup.js. Receives everything it needs
 * via openTagsPopup() and calls back onClose() when dismissed.
 *
 * No direct dependency on signal-popup.js — no circular imports.
 *
 * Public API:
 *   openTagsPopup(nodes, latlng, startNodeIdx, onClose)
 */

import { map }            from './map.js';
import { t, applyI18n }   from './i18n.js';


/* ===== Template accessors ===== */

const _tplTagsPopup = () => document.getElementById('tpl-osm-tags-popup');
const _tplTagRow    = () => document.getElementById('tpl-osm-tag-row');


/* ===== Module state ===== */

let _tagsPopup   = null;
let _tagsNodeIdx = 0;
let _nodes       = null;
let _latlng      = null;
let _onClose     = null;


/* ===== Public API ===== */

/**
 * Open the OSM tags preview popup.
 * Replaces the current Leaflet popup (Leaflet limitation: only one popup at a time).
 *
 * @param {OsmNode[]} nodes        - nodes computed by signal-mapping.js
 * @param {number[]}  latlng       - [lat, lng] anchor for the popup
 * @param {number}    startNodeIdx - which node to display first
 * @param {Function}  onClose      - called when the popup is closed (button or Escape);
 *                                   signal-popup.js uses this to restore itself
 */
export function openTagsPopup(nodes, latlng, startNodeIdx, onClose) {
    if (_tagsPopup) {
        _tagsPopup.remove();
        _tagsPopup = null;
    }

    _nodes       = nodes;
    _latlng      = latlng;
    _onClose     = onClose;
    _tagsNodeIdx = Math.max(0, Math.min(startNodeIdx, nodes.length - 1));

    _tagsPopup = L.popup({
        autoPan:     true,
        closeButton: false,
        className:   'pu-leaflet pu-tags-leaflet',
    }).setLatLng(latlng).setContent(_buildTagsPopup());

    // Register BEFORE openOn(): Leaflet fires 'popupopen' synchronously.
    map.once('popupopen', () => {
        const el = _tagsPopup?.getElement();
        if (!el) return;
        el.addEventListener('click', _onTagsPopupClick);
        el.addEventListener('keydown', _onTagsKeydown);
        el.tabIndex = -1;
        el.focus();
    });

    _tagsPopup.openOn(map);
}


/* ===== Internal event handlers ===== */

function _onTagsPopupClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();

    switch (btn.dataset.action) {
        case 'tags-close':
            _close();
            break;

        case 'tags-prev':
            _tagsNodeIdx = (_tagsNodeIdx - 1 + _nodes.length) % _nodes.length;
            _tagsPopup.setContent(_buildTagsPopup());
            break;

        case 'tags-next':
            _tagsNodeIdx = (_tagsNodeIdx + 1) % _nodes.length;
            _tagsPopup.setContent(_buildTagsPopup());
            break;
    }
}

function _onTagsKeydown(e) {
    if (e.key !== 'Escape') return;
    // Stop the event completely so Leaflet's map keyboard handler
    // does not close the signal popup that _close() is about to restore.
    e.stopImmediatePropagation();
    e.preventDefault();
    _close();
}

function _close() {
    if (!_tagsPopup) return;
    _tagsPopup.remove();
    _tagsPopup = null;
    _onClose?.();
}


/* ===== DOM builder ===== */

function _buildTagsPopup() {
    const total = _nodes.length;
    const node  = _nodes[_tagsNodeIdx];

    const wrap = _tplTagsPopup().content.cloneNode(true).querySelector('.pu-tags-wrap');
    applyI18n(wrap);

    wrap.querySelector('.pu-tags-node-label').textContent =
        t('popup.nodeLabel', _tagsNodeIdx + 1, total);

    if (total > 1) {
        wrap.querySelectorAll('.pu-tags-arrow').forEach(btn =>
            btn.classList.remove('is-hidden')
        );
    }

    const list   = wrap.querySelector('.pu-tags-list');
    const tplRow = _tplTagRow();
    const frag   = document.createDocumentFragment();

    if (node?.tags?.size) {
        for (const [k, v] of node.tags.entries()) {
            const row = tplRow.content.cloneNode(true).querySelector('.pu-osm-row');
            row.querySelector('.pu-osm-key').textContent = k;
            row.querySelector('.pu-osm-val').textContent = v;
            frag.appendChild(row);
        }
    }
    list.appendChild(frag);

    return wrap;
}

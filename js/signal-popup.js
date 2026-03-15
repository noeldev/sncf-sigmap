/**
 * signal-popup.js — Signal data popup.
 *
 * Displays SNCF signal properties and OSM export actions.
 * Opens tags-popup.js on demand for the OSM tags preview.
 *
 * No dependency from tags-popup.js back to this file — no circular imports.
 *
 * NOTE - unfiltered features:
 *   openSignalPopup() always receives the COMPLETE set of co-located features
 *   (group.all from the worker). Filters control marker visibility only.
 *
 * Public API:
 *   openSignalPopup(latlng, feats, idx?)
 */

import { map }                                    from './map.js';
import { getTypeColor, getOsmNodes }              from './signal-mapping.js';
import { t, applyI18n, onLangChange }             from './i18n.js';
import { checkSignalGroup, invalidateSignalGroup } from './overpass.js';
import { josmAddNode }                            from './josm.js';
import { openTagsPopup }                          from './tags-popup.js';


/* ===== Template accessors ===== */

const _tplPopup = () => document.getElementById('tpl-signal-popup');


/* ===== Contrast helper ===== */

function _contrastColor(hex) {
    if (!hex) return '#fff';
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) >= 128 ? '#000' : '#fff';
}


/* ===== Module state ===== */

let _popup          = null;
let _feats          = null;
let _latlng         = null;
let _statuses       = null;
let _currentIdx     = 0;
let _nodes          = null;
let _featToNodeIdx  = null;
let _currentNodeIdx = -1;


/* ===== Public entry point ===== */

export function openSignalPopup(latlng, feats, idx = 0) {
    if (_popup) {
        _popup.remove();
        _popup = null;
    }

    _feats      = feats;
    _latlng     = latlng;
    _statuses   = null;
    _currentIdx = idx;

    _openSignalPopup();

    checkSignalGroup(feats).then(results => {
        _statuses = results;
        if (_popup?.isOpen()) {
            _popup.setContent(_build(_currentIdx));
        }
    });
}


/* ===== Signal popup lifecycle ===== */

function _openSignalPopup() {
    _popup = L.popup({
        maxWidth:    520,
        autoPan:     true,
        closeButton: false,
        className:   'pu-leaflet',
    }).setLatLng(_latlng).setContent(_build(_currentIdx));

    // Register BEFORE openOn(): Leaflet fires 'popupopen' synchronously inside
    // openOn(), so a listener registered after the call would never fire.
    map.once('popupopen', () => {
        const el = _popup?.getElement();
        if (!el) return;
        el.addEventListener('click', _onSignalPopupClick);
        _trapFocus(el);
        _initSignalKeyboard(el);
    });

    _popup.openOn(map);
}

/** Restore the signal popup after tags popup was closed. */
function _restoreSignalPopup() {
    _openSignalPopup();
    // Statuses are already cached — no need to re-fetch Overpass.
    if (_statuses) {
        _popup.setContent(_build(_currentIdx));
    }
}

function _onSignalPopupClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();

    switch (btn.dataset.action) {
        case 'close':
            _popup?.remove();
            _popup = null;
            break;

        case 'nav-prev': {
            const next = (_currentIdx - 1 + _feats.length) % _feats.length;
            _currentIdx = next;
            _popup.setContent(_build(next));
            break;
        }

        case 'nav-next': {
            const next = (_currentIdx + 1) % _feats.length;
            _currentIdx = next;
            _popup.setContent(_build(next));
            break;
        }

        case 'node-preview':
            openTagsPopup(_nodes, _latlng, _currentNodeIdx, _restoreSignalPopup);
            break;

        case 'copy':
            _copyTags(_currentNode(), btn);
            break;

        case 'josm':
            _sendToJOSM(_currentNode(), btn);
            break;

        case 'osm-retry':
            _statuses = null;
            _popup.setContent(_build(_currentIdx));
            checkSignalGroup(_feats, true).then(results => {
                _statuses = results;
                if (_popup?.isOpen()) {
                    _popup.setContent(_build(_currentIdx));
                }
            });
            break;
    }
}

function _currentNode() {
    if (!_nodes || _currentNodeIdx < 0) return null;
    return _nodes[_currentNodeIdx] ?? null;
}


/* ===== DOM builder ===== */

const _DATA_FIELDS = ['code_ligne', 'code_voie', 'nom_voie', 'sens', 'position', 'pk'];

function _mapElements(wrap) {
    const rows = Object.fromEntries(
        [...wrap.querySelectorAll('.pu-row[data-field]')].map(r => [r.dataset.field, r])
    );
    return {
        navGroup:       wrap.querySelector('.pu-nav-group'),
        navLabel:       wrap.querySelector('.pu-nav-label'),
        idVal:          rows.idreseau?.querySelector('.pu-val'),
        idRow:          rows.idreseau,
        coordsVal:      rows.coords?.querySelector('.pu-val'),
        nodeCounter:    wrap.querySelector('.pu-node-counter'),
        nodePreviewBtn: wrap.querySelector('[data-action="node-preview"]'),
        josmBtn:        wrap.querySelector('[data-action="josm"]'),
        copyBtn:        wrap.querySelector('[data-action="copy"]'),
        rows,
    };
}

function _build(idx) {
    const s       = _feats[idx];
    const p       = s.p;
    const total   = _feats.length;
    const osmInfo = _statuses?.[idx] ?? { status: 'checking', nodeId: null };

    const result    = getOsmNodes(_feats);
    _nodes          = result.nodes;
    _featToNodeIdx  = result.featToNodeIdx;
    const nodeIdx   = _featToNodeIdx.get(s);
    _currentNodeIdx = nodeIdx ?? -1;
    const node      = nodeIdx !== undefined ? _nodes[nodeIdx] : null;

    const wrap = _tplPopup().content.cloneNode(true).querySelector('.pu-wrap');
    applyI18n(wrap);

    const color = getTypeColor(p.type_if);
    wrap.style.setProperty('--signal-color',    color);
    wrap.style.setProperty('--signal-contrast', _contrastColor(color));

    const el = _mapElements(wrap);

    if (total > 1) {
        el.navGroup.classList.remove('is-hidden');
        el.navLabel.textContent = t('popup.navLabel', idx + 1, total);
    }

    wrap.querySelector('.pu-row[data-field="type_if"] .pu-badge').textContent = p.type_if ?? '';

    for (const field of _DATA_FIELDS) {
        const row = el.rows[field];
        if (row) {
            row.querySelector('.pu-val').textContent = p[field] ?? '';
        }
    }

    el.idVal.textContent = p.idreseau ?? '';
    _applyOsmStatus(el.idRow, osmInfo, s);

    el.coordsVal.textContent = `${s.lat.toFixed(6)}\u2009\u2009${s.lng.toFixed(6)}`;

    if (_nodes.length === 0) {
        el.nodeCounter.textContent = t('popup.nodeNone');
        el.nodePreviewBtn.disabled = true;
    } else {
        el.nodeCounter.textContent = t('popup.nodeLabel', (nodeIdx ?? 0) + 1, _nodes.length);
        el.nodePreviewBtn.disabled = !node;
    }

    if (!node) {
        el.josmBtn.disabled = true;
        el.copyBtn.disabled  = true;
    }

    return wrap;
}

function _applyOsmStatus(idRow, { status, nodeId }, feat) {
    if (status === 'checking') return;

    idRow.querySelector('.osm-checking').classList.add('is-hidden');

    if (status === 'in-osm') {
        const link = idRow.querySelector('.osm-in-osm');
        link.classList.remove('is-hidden');
        link.href = `https://www.openstreetmap.org/node/${nodeId}`;
        const lbl = t('osm.inOsm', nodeId);
        link.title = lbl;
        link.setAttribute('aria-label', lbl);
    } else if (status === 'not-in-osm') {
        const link = idRow.querySelector('.osm-locate');
        link.classList.remove('is-hidden');
        link.href = `https://www.openstreetmap.org/?mlat=${feat.lat.toFixed(6)}&mlon=${feat.lng.toFixed(6)}&zoom=18`;
    } else if (status === 'error') {
        idRow.querySelector('.osm-retry').classList.remove('is-hidden');
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

    if (_statuses?.some(s => s.status === 'in-osm')) {
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

function _initSignalKeyboard(popupEl) {
    if (!popupEl) return;
    popupEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            _popup?.remove();
            _popup = null;
            return;
        }

        if (_feats.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.stopPropagation();
            e.preventDefault();
            const next =
                (_currentIdx + (e.key === 'ArrowRight' ? 1 : -1) + _feats.length) % _feats.length;
            _currentIdx = next;
            _popup.setContent(_build(next));
            return;
        }

        if (e.key === 'Tab') {
            const focusable = [...popupEl.querySelectorAll(
                'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'
            )].filter(n => !n.closest('.is-hidden'));
            if (!focusable.length) return;
            const first = focusable[0];
            const last  = focusable[focusable.length - 1];
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


/* ===== Language change ===== */

onLangChange(() => {
    if (!_popup?.isOpen()) return;

    const counter = document.querySelector('.leaflet-popup .pu-node-counter');
    if (counter && _nodes?.length && _currentNodeIdx >= 0) {
        counter.textContent = t('popup.nodeLabel', _currentNodeIdx + 1, _nodes.length);
    }
});

/**
 * popup.js
 * Signal popup: display, navigation, OSM tag export, JOSM Remote Control.
 *
 * All HTML structure lives in index.html (tpl-signal-popup, tpl-osm-tag-row).
 * This module only fills values and toggles CSS classes — no HTML strings.
 *
 * Badge colour is driven by CSS custom properties --signal-color and
 * --signal-contrast set on .pu-wrap (from getTypeColor / _contrastColor).
 *
 * The copy/JOSM flash animation is CSS-driven via class "is-flash".
 *
 * NOTE — unfiltered features:
 *   openSignalPopup() always receives the COMPLETE list of co-located
 *   features (group.all from the worker), not the filtered subset.
 *   Filters control marker visibility only; the popup always exports all
 *   signals at a location so that no OSM tags are lost on JOSM import.
 */

import { map } from './map.js';
import { getTypeColor, isSupported, buildOsmTags } from './signal-mapping.js';
import { t, applyI18n, onLangChange } from './i18n.js';
import { checkOsmBatch, invalidateNotInOsm } from './overpass.js';
import { josmAddNode } from './josm.js';

/* ===== Module-level template accessors ===== */

const _tplPopup = () => document.getElementById('tpl-signal-popup');
const _tplOsmRow = () => document.getElementById('tpl-osm-tag-row');

/* ===== Contrast helper ===== */

/**
 * Returns '#000' or '#fff' for readable text on the given hex background.
 */
function _contrastColor(hex) {
    if (!hex) return '#fff';
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) >= 128 ? '#000' : '#fff';
}

/* ===== Tag helpers ===== */

function _tagsToText(m) {
    return [...m.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
}

/* ===== Popup state ===== */

let _popup = null;
let _statuses = null;
let _currentIdx = 0;

export function openSignalPopup(latlng, feats, idx = 0) {
    if (_popup) {
        _popup.remove();
        _popup = null;
    }

    _statuses = null;
    _currentIdx = idx;

    _popup = L.popup({
        maxWidth: 600,
        autoPan: true,
        closeButton: false,
        className: 'pu-leaflet',
    }).setLatLng(latlng).setContent(_build(feats, idx)).openOn(map);

    checkOsmBatch(feats).then(results => {
        _statuses = results;
        if (_popup?.isOpen()) _popup.setContent(_build(feats, _currentIdx));
    });

    _popup.getElement()?.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        e.stopPropagation();

        switch (btn.dataset.action) {
            case 'close':
                _popup?.remove();
                _popup = null;
                break;

            case 'nav-prev': {
                const next = (_currentIdx - 1 + feats.length) % feats.length;
                _currentIdx = next;
                _popup.setContent(_build(feats, next));
                break;
            }
            case 'nav-next': {
                const next = (_currentIdx + 1) % feats.length;
                _currentIdx = next;
                _popup.setContent(_build(feats, next));
                break;
            }
            case 'copy':
                _copyTags(feats, btn);
                break;

            case 'josm':
                _sendToJOSM(feats, latlng, btn);
                break;

            case 'osm-retry':
                _statuses = null;
                if (_popup?.isOpen()) _popup.setContent(_build(feats, _currentIdx));
                checkOsmBatch(feats, true).then(results => {
                    _statuses = results;
                    if (_popup?.isOpen()) _popup.setContent(_build(feats, _currentIdx));
                });
                break;
        }
    });

    _trapFocus(_popup.getElement());
    _initKeyboard(_popup.getElement(), feats);
}

/* ===== Popup DOM (template-driven) ===== */

const _DATA_FIELDS = ['code_ligne', 'code_voie', 'nom_voie', 'sens', 'position', 'pk'];

/**
 * Build a DOM element map from the cloned popup wrapper.
 * All .pu-row[data-field] elements are indexed by field name for O(1) access.
 */
function _mapElements(wrap) {
    const rows = Object.fromEntries(
        [...wrap.querySelectorAll('.pu-row[data-field]')].map(r => [r.dataset.field, r])
    );
    return {
        navGroup: wrap.querySelector('.pu-nav-group'),
        navLabel: wrap.querySelector('.pu-nav-label'),
        osmSummary: wrap.querySelector('.pu-osm-summary'),
        osmNote: wrap.querySelector('.pu-osm-note'),
        osmList: wrap.querySelector('.pu-osm-list'),
        coordsVal: rows.coords?.querySelector('.pu-val'),
        coordsLink: rows.coords?.querySelector('.pu-coords-btn'),
        idRow: rows.idreseau,
        idVal: rows.idreseau?.querySelector('.pu-val'),
        rows,
    };
}

function _build(feats, idx) {
    const s = feats[idx];
    const p = s.p;
    const total = feats.length;
    const osmInfo = _statuses?.[idx] ?? { status: 'checking', nodeId: null };

    const wrap = _tplPopup().content.cloneNode(true).querySelector('.pu-wrap');
    applyI18n(wrap);

    const color = getTypeColor(p.type_if);
    wrap.style.setProperty('--signal-color', color);
    wrap.style.setProperty('--signal-contrast', _contrastColor(color));

    const el = _mapElements(wrap);

    if (total > 1) {
        el.navGroup.classList.remove('is-hidden');
        el.navLabel.textContent = t('popup.navLabel', idx + 1, total);
    }

    wrap.querySelector('.pu-row[data-field="type_if"] .pu-badge').textContent = p.type_if ?? '';

    for (const field of _DATA_FIELDS) {
        const row = el.rows[field];
        if (row) row.querySelector('.pu-val').textContent = p[field] ?? '';
    }

    el.idVal.textContent = p.idreseau ?? '';
    _applyOsmStatus(el.idRow, osmInfo);

    el.coordsVal.textContent =
        `${s.lat.toFixed(6)}\u2009\u2009${s.lng.toFixed(6)}`;
    el.coordsLink.href =
        `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(6)}&mlon=${s.lng.toFixed(6)}&zoom=18`;

    const supportedCount = feats.filter(f => isSupported(f.p.type_if)).length;
    el.osmSummary.textContent = t('popup.osmTags', supportedCount);
    el.osmSummary.dataset.count = supportedCount;

    if (supportedCount > 1) {
        el.osmNote.textContent = t('popup.merged', supportedCount);
        el.osmNote.classList.remove('is-hidden');
    }

    // OSM tag rows — single DocumentFragment append avoids per-row reflow.
    const tplRow = _tplOsmRow();
    const frag = document.createDocumentFragment();
    for (const [k, v] of buildOsmTags(feats).entries()) {
        const row = tplRow.content.cloneNode(true).querySelector('.pu-osm-row');
        row.querySelector('.pu-osm-key').textContent = k;
        const valEl = row.querySelector('.pu-osm-val');
        valEl.textContent = v;
        if (v === '*') valEl.classList.add('pu-osm-unknown');
        frag.appendChild(row);
    }
    el.osmList.appendChild(frag);

    return wrap;
}

function _applyOsmStatus(idRow, { status, nodeId }) {
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
        idRow.querySelector('.osm-not-in-osm').classList.remove('is-hidden');
    } else if (status === 'error') {
        idRow.querySelector('.osm-retry').classList.remove('is-hidden');
    }
}

/* ===== Actions ===== */

function _copyTags(feats, btn) {
    const tagMap = buildOsmTags(feats);
    if (!tagMap.size) return;
    const tagText = _tagsToText(tagMap);
    // Invalidate 'not-in-osm' so the next popup open triggers a fresh check.
    invalidateNotInOsm(feats);
    navigator.clipboard.writeText(tagText)
        .then(() => _flash(btn))
        .catch(() => prompt(t('popup.copyPrompt'), tagText));
}

async function _sendToJOSM(feats, latlng, btn) {
    const tagMap = buildOsmTags(feats);
    if (!tagMap.size) return;

    if (_statuses?.some(s => s.status === 'in-osm')) {
        const msg = feats.length > 1 ? t('osm.warnMulti') : t('osm.warnSingle');
        if (!confirm(msg)) return;
    }

    try {
        await josmAddNode(latlng, tagMap);
        // Invalidate 'not-in-osm' so the next popup open triggers a fresh check.
        invalidateNotInOsm(feats);
        _flash(btn);
    } catch (err) {
        console.warn('[JOSM]', err.message);
        alert(`${t('josm.notReachable')}: ${err.message}`);
    }
}

/**
 * Flash a footer button into its success state.
 * All visual changes are in style.css via .is-flash.
 */
function _flash(btn) {
    if (!btn) return;
    btn.classList.add('is-flash');
    setTimeout(() => btn.classList.remove('is-flash'), 2400);
}

/* ===== Accessibility helpers ===== */

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

function _initKeyboard(popupEl, feats) {
    if (!popupEl) return;
    popupEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            _popup?.remove();
            _popup = null;
            return;
        }
        if (feats.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.stopPropagation();
            e.preventDefault();
            const next =
                (_currentIdx + (e.key === 'ArrowRight' ? 1 : -1) + feats.length) % feats.length;
            _currentIdx = next;
            _popup.setContent(_build(feats, next));
            return;
        }
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

/* ===== Lang change: update open popup summary text ===== */

onLangChange(() => {
    const summary = document.querySelector('.pu-osm-summary');
    if (!summary) return;
    const count = parseInt(summary.dataset.count || '0', 10);
    summary.textContent = t('popup.osmTags', count);
});

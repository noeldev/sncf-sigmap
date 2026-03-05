/**
 * popup.js
 * Signal popup: display, navigation, OSM tag export, JOSM Remote Control.
 */

import { map } from './map.js';
import {
    SIGNAL_MAPPING, FIELD_CONVERTERS, COMMON_TAGS,
    getTypeColor, isSupported
} from './signal-mapping.js';
import { t } from './i18n.js';
import { checkOsmBatch } from './osm-check.js';

export { getTypeColor };

/* ===== Contrast helper ===== */

/**
 * Returns '#000' (dark) or '#fff' (light) for text on a given hex background.
 * Uses the YIQ luminance formula so there is no need for a hard-coded set.
 */
function _contrastColor(hex) {
    if (!hex) return '#fff';
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) >= 128 ? '#000' : '#fff';
}

/* ===== Tag resolution ===== */

function _resolve(tmpl, p) {
    return tmpl.replace(/\{\{(\w+)\}\}/g, (_, f) => {
        const c = FIELD_CONVERTERS[f]; return c ? c(p[f] ?? '') : (p[f] ?? '');
    });
}
function _parseTag(s) { const i = s.indexOf('='); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]; }

function _resolveOne(feat) {
    const tags = new Map();
    for (const tmpl of (SIGNAL_MAPPING[feat.p.type_if]?.tags || [])) {
        const [k, v] = _parseTag(_resolve(tmpl, feat.p)); if (k) tags.set(k, v);
    }
    return tags;
}

function _buildOsmTags(feats) {
    const supported = feats.filter(f => isSupported(f.p.type_if));
    if (!supported.length) return new Map();
    const m = new Map();
    for (const tmpl of COMMON_TAGS) {
        const [k, v] = _parseTag(_resolve(tmpl, supported[0].p)); if (k) m.set(k, v);
    }
    for (const feat of supported) for (const [k, v] of _resolveOne(feat)) m.set(k, v);
    return m;
}

function _tagsToText(m) { return [...m.entries()].map(([k, v]) => `${k}=${v}`).join('\n'); }

/* ===== Tooltip ===== */

export function buildTooltip(feats) {
    const p = feats[0].p;

    // Signal rows: type_if (colored, left) + idreseau (right, aligned with tt-val column)
    const sigRows = feats.map(f => {
        const color = getTypeColor(f.p.type_if);
        const id = f.p.idreseau
            ? `<span class="tt-val tt-id">${f.p.idreseau}</span>`
            : '<span class="tt-val tt-id"></span>';
        return `<div class="tt-row tt-sig">
      <span class="tt-type" style="color:${color}">${f.p.type_if || '?'}</span>${id}
    </div>`;
    }).join('');

    const sep = '<div class="tt-sep"></div>';
    const common = [
        _ttRow('Code voie', p.code_voie),
        _ttRow('Nom voie',  p.nom_voie),
        _ttRow('Sens',      p.sens),
        _ttRow('Position',  p.position),
        _ttRow('PK',        p.pk),
    ].filter(Boolean).join('');

    return sigRows + (common ? sep + common : '');
}

function _ttRow(label, val) {
    if (!val) return '';
    return `<div class="tt-row"><span class="tt-key">${label}</span><span class="tt-val">${val}</span></div>`;
}

/* ===== Popup state ===== */

let _popup      = null;
let _statuses   = null;
let _currentIdx = 0;   // tracks nav position so retry uses the correct index

export function openSignalPopup(latlng, feats, idx = 0) {
    if (_popup) { _popup.remove(); _popup = null; }
    _statuses   = null;
    _currentIdx = idx;

    _popup = L.popup({
        maxWidth: 360, autoPan: true, closeButton: false, className: 'pu-leaflet',
    }).setLatLng(latlng).setContent(_build(feats, idx)).openOn(map);

    // Single batch Overpass query for the whole co-located group
    checkOsmBatch(feats).then(results => {
        _statuses = results;
        if (_popup?.isOpen()) _popup.setContent(_build(feats, _currentIdx));
    });

    _popup.getElement()?.addEventListener('click', e => {
        const tgt = e.target;

        if (tgt.closest('[data-action="close"]')) {
            e.stopPropagation();
            _popup?.remove(); _popup = null; return;
        }

        const nav = tgt.closest('[data-nav]');
        if (nav) {
            e.stopPropagation();
            let next = parseInt(nav.dataset.nav);
            if (next < 0)             next = feats.length - 1;
            if (next >= feats.length) next = 0;
            _currentIdx = next;
            _popup.setContent(_build(feats, next));
            return;
        }

        if (tgt.closest('[data-action="copy"]')) {
            e.stopPropagation();
            _copyTags(feats, tgt.closest('[data-action="copy"]'));
            return;
        }

        if (tgt.closest('[data-action="josm"]')) {
            e.stopPropagation();
            _sendToJOSM(feats, latlng, tgt.closest('[data-action="josm"]'));
            return;
        }

        if (tgt.closest('[data-action="osm-retry"]')) {
            e.stopPropagation();
            _statuses = null;
            if (_popup?.isOpen()) _popup.setContent(_build(feats, _currentIdx));
            checkOsmBatch(feats, true).then(results => {
                _statuses = results;
                if (_popup?.isOpen()) _popup.setContent(_build(feats, _currentIdx));
            });
        }
    });

    // Focus tracking: accent border while popup has keyboard focus
    const popupEl = _popup.getElement();
    if (popupEl) {
        popupEl.addEventListener('focusin', () => popupEl.classList.add('pu-focused'));
        popupEl.addEventListener('focusout', e => {
            // relatedTarget is null when focus leaves the document entirely,
            // or points outside the popup — either way remove the class.
            if (!popupEl.contains(e.relatedTarget))
                popupEl.classList.remove('pu-focused');
        });
    }

    // Keyboard: arrow keys navigate signals; Tab is trapped inside popup; Escape closes.
    _popup.getElement()?.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            _popup?.remove(); _popup = null; return;
        }
        if (feats.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.stopPropagation(); e.preventDefault();
            let next = _currentIdx + (e.key === 'ArrowRight' ? 1 : -1);
            if (next < 0)             next = feats.length - 1;
            if (next >= feats.length) next = 0;
            _currentIdx = next;
            _popup.setContent(_build(feats, next));
            return;
        }
        // Tab trap: keep focus cycling within the popup
        if (e.key === 'Tab') {
            const el = _popup.getElement();
            const focusable = [...el.querySelectorAll(
                'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'
            )].filter(n => !n.closest('.is-hidden'));
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    });
}

/* ===== Popup HTML ===== */

function _build(feats, idx) {
    const s            = feats[idx];
    const p            = s.p;
    const total        = feats.length;
    const color        = getTypeColor(p.type_if);
    const textColor    = _contrastColor(color);
    const osmInfo      = _statuses?.[idx] ?? { status: 'checking', nodeId: null };
    const anySupported = feats.some(f => isSupported(f.p.type_if));

    const nav = `
    <div class="pu-nav">
      ${total > 1 ? `<div class="pu-nav-group">
        <button class="pu-nav-btn" data-nav="${idx - 1}" title="${t('popup.prev')}" aria-label="${t('popup.prev')}">
          <svg class="icon" width="14" height="14" aria-hidden="true"><use href="#icon-chevron-left"></use></svg>
        </button>
        <span class="pu-nav-label">${idx + 1}&thinsp;/&thinsp;${total}</span>
        <button class="pu-nav-btn" data-nav="${idx + 1}" title="${t('popup.next')}" aria-label="${t('popup.next')}">
          <svg class="icon" width="14" height="14" aria-hidden="true"><use href="#icon-chevron-right"></use></svg>
        </button>
      </div>` : ''}
      <button class="pu-close-btn" data-action="close" title="${t('popup.close')}" aria-label="${t('popup.close')}">&#10005;</button>
    </div>`;

    const FIELDS = [
        ['type_if', 'TYPE IF'], ['code_ligne', 'CODE LIGNE'],
        ['code_voie', 'CODE VOIE'], ['nom_voie', 'NOM VOIE'],
        ['sens', 'SENS'], ['position', 'POSITION'], ['pk', 'PK'],
    ];
    const rows = FIELDS.map(([f, label]) => {
        const val = p[f]; if (!val && val !== 0) return '';
        const display = f === 'type_if'
            ? `<span class="pu-badge" style="background:${color};color:${textColor}">${val}</span>`
            : `<span class="pu-val">${val}</span>`;
        return `<div class="pu-row"><span class="pu-label">${label}</span>${display}</div>`;
    }).join('');

    const idRow = p.idreseau ? `
    <div class="pu-row">
      <span class="pu-label">ID RÉSEAU</span>
      <span class="pu-val">${p.idreseau}</span>
      ${_osmIndicator(osmInfo)}
    </div>` : '';

    const osmMapUrl = `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(6)}&mlon=${s.lng.toFixed(6)}&zoom=18`;
    const coord = `<div class="pu-row">
    <span class="pu-label">COORDS</span>
    <span class="pu-val">${s.lat.toFixed(6)},&thinsp;${s.lng.toFixed(6)}</span>
    <a class="pu-coords-btn" href="${osmMapUrl}" target="_blank" rel="noopener"
       title="${t('popup.viewOnOsm')}" aria-label="${t('popup.viewOnOsm')}">
      <svg class="icon" width="13" height="13" aria-hidden="true"><use href="#icon-locate"></use></svg>
    </a>
  </div>`;

    let osmSection = '';
    if (anySupported) {
        const tagMap  = _buildOsmTags(feats);
        const osmRows = [...tagMap.entries()].map(([k, v]) => `
      <div class="pu-osm-row">
        <span class="pu-osm-key">${k}</span>
        <span class="pu-osm-val${v === '*' ? ' pu-osm-unknown' : ''}">${v}</span>
      </div>`).join('');
        const supportedCount = feats.filter(f => isSupported(f.p.type_if)).length;
        const note = supportedCount > 1
            ? `<div class="pu-osm-note">${t('popup.merged', supportedCount)}</div>` : '';
        osmSection = `
      <details class="pu-osm-preview">
        <summary>${t('popup.osmTags', supportedCount)}</summary>
        <div class="pu-osm-scroll">${note}<div class="pu-osm-list">${osmRows}</div></div>
      </details>`;
    }

    const josmDisabled = !anySupported ? ' disabled title="No supported signals at this location"' : '';

    const footer = `
    <div class="pu-footer">
      <button class="pu-action-btn" data-action="copy"
              ${!anySupported ? 'disabled title="No supported signals at this location"' : `title="${t('popup.copy')}"`}>
        <svg class="icon" width="13" height="13" aria-hidden="true"><use href="#icon-copy"></use></svg>
        ${t('popup.copy')}
      </button>
      <button class="pu-action-btn pu-josm-btn" data-action="josm"${josmDisabled}
              ${anySupported ? `title="${t('popup.josm')}"` : ''}>
        <img src="assets/svg/josm.svg" width="14" height="14" alt="" class="btn-icon">
        ${t('popup.josm')}
      </button>
    </div>`;

    return `<div class="pu-wrap">${nav}<div class="pu-body">${rows}${idRow}${coord}</div>${osmSection}${footer}</div>`;
}

function _osmIndicator({ status, nodeId }) {
    if (status === 'checking') {
        return `<span class="pu-osm-indicator osm-checking" title="${t('osm.checking')}">…</span>`;
    }
    if (status === 'in-osm' && nodeId) {
        const href = `https://www.openstreetmap.org/node/${nodeId}`;
        return `<a class="pu-osm-indicator" href="${href}" target="_blank" rel="noopener"
               title="${t('osm.inOsm')} — node #${nodeId}"
             ><img src="assets/svg/osm.svg" width="16" height="16" alt="OSM"
                   class="osm-img"></a>`;
    }
    if (status === 'not-in-osm') {
        return `<span class="pu-osm-indicator" title="${t('osm.notInOsm')}"
            ><img src="assets/svg/osm.svg" width="16" height="16" alt=""
                  class="osm-img-dim"></span>`;
    }
    if (status === 'error') {
        return `<button class="pu-osm-indicator osm-retry" data-action="osm-retry"
                        title="${t('osm.retry')}">
          <svg class="icon" width="14" height="14" aria-hidden="true"><use href="#icon-refresh"></use></svg>
        </button>`;
    }
    return '';
}

/* ===== Actions ===== */

function _copyTags(feats, btn) {
    const m = _buildOsmTags(feats);
    if (!m.size) return;
    navigator.clipboard.writeText(_tagsToText(m))
        .then(() => _flash(btn, t('popup.copied'), '#4ade80', '#0b0e16'))
        .catch(()  => prompt('Copy OSM tags:', _tagsToText(m)));
}

function _sendToJOSM(feats, latlng, btn) {
    const tagMap = _buildOsmTags(feats);
    if (!tagMap.size) return;

    const alreadyInOsm = _statuses?.some(s => s.status === 'in-osm');
    if (alreadyInOsm) {
        const msg = feats.length > 1 ? t('osm.warnMulti') : t('osm.warnSingle');
        if (!confirm(msg)) return;
    }

    const addtags = [...tagMap.entries()]
        .map(([k, v]) => encodeURIComponent(`${k}=${v}`))
        .join(encodeURIComponent('|'));

    const addUrl = `http://127.0.0.1:8111/add_node?lat=${latlng[0]}&lon=${latlng[1]}&addtags=${addtags}`;

    fetch(addUrl, { mode: 'no-cors' })
        .then(() => _flash(btn, t('popup.josmSent'), '#4ade80', '#0b0e16'))
        .catch(err => { console.warn('[JOSM]', err.message); alert('JOSM not reachable: ' + err.message); });
}

function _flash(btn, label, bg, fg) {
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg class="icon" width="13" height="13" aria-hidden="true"><use href="#icon-check"></use></svg> ${label}`;
    btn.style.background = bg; btn.style.color = fg;
    setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2400);
}

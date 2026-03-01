/**
 * popup.js
 * Signal popup: display, navigation, OSM tag export, JOSM Remote Control.
 *
 * JOSM / Mixed Content note:
 *   Netlify is served over HTTPS. Browsers allow HTTP requests to 127.0.0.1
 *   (but not to "localhost") from HTTPS pages in Firefox and Chrome.
 *   Image() sends a passive mixed-content request, which is less strictly
 *   blocked than fetch(). JOSM responds with HTML, not an image, so img.onerror
 *   fires even on a successful call; both handlers display "Sent to JOSM".
 */

import { map }                                            from './map.js';
import { SIGNAL_MAPPING, FIELD_CONVERTERS, COMMON_TAGS } from './signal-mapping.js';
import { t }                                             from './i18n.js';
import { checkOsm }                                      from './osm-check.js';

/* ===== Colour mapping ===== */

const TYPE_GROUPS = {
  'CARRE':'main', 'CV':'main', 'S':'main', 'GA':'main',
  'A':'distant', 'D':'distant',
  'TIV D FIXE':'speed', 'TIV D MOB':'speed', 'TIV R MOB':'speed',
  'TIV PENDIS':'speed', 'TIV PENEXE':'speed', 'TIV PENREP':'speed',
  'Z':'speed', 'R':'speed',
  'ID':'route', 'IDD':'route', 'CHEVRON':'route',
  'ARRET VOY':'stop', 'HEURTOIR':'stop',
  'PN':'crossing',
};
const GROUP_COLORS = {
  main:'#e85d5d', distant:'#f5c842', speed:'#fb923c',
  route:'#38bdf8', stop:'#60a5fa', crossing:'#4ade80', unknown:'#6b7280',
};

export function getTypeColor(type) { return GROUP_COLORS[TYPE_GROUPS[type] || 'unknown']; }
export function isSupported(type)  { return !!SIGNAL_MAPPING[type]; }

/* ===== Tag resolution ===== */

function _resolve(tmpl, p) {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, f) => {
    const c = FIELD_CONVERTERS[f]; return c ? c(p[f] ?? '') : (p[f] ?? '');
  });
}
function _parseTag(s) { const i = s.indexOf('='); return i < 0 ? [s,''] : [s.slice(0,i), s.slice(i+1)]; }

function _resolveOne(feat) {
  const tags = new Map();
  for (const tmpl of (SIGNAL_MAPPING[feat.p.type_if] || [])) {
    const [k, v] = _parseTag(_resolve(tmpl, feat.p));
    if (k) tags.set(k, v);
  }
  return tags;
}

function _buildOsmTags(feats) {
  const m = new Map();
  for (const tmpl of COMMON_TAGS) {
    const [k, v] = _parseTag(_resolve(tmpl, feats[0].p)); if (k) m.set(k, v);
  }
  for (const feat of feats) for (const [k, v] of _resolveOne(feat)) m.set(k, v);
  return m;
}

function _tagsToText(m) { return [...m.entries()].map(([k,v]) => `${k}=${v}`).join('\n'); }

/* ===== Tooltip ===== */

export function buildTooltip(feats) {
  const p = feats[0].p;

  const typeRow = feats.length > 1
    ? feats.map(f => `<span style="color:${getTypeColor(f.p.type_if)};font-weight:700">${f.p.type_if}</span>`).join(' · ')
    : `<span style="color:${getTypeColor(p.type_if)};font-weight:700">${p.type_if || '?'}</span>`;

  const idRows = feats.length > 1
    ? feats.map(f => f.p.idreseau).filter(Boolean).map(id => _ttRow('ID réseau', id)).join('')
    : _ttRow('ID réseau', p.idreseau);

  return `<div class="tt-types">${typeRow}</div>`
    + _ttRow('Code voie', p.code_voie)
    + _ttRow('Nom voie',  p.nom_voie)
    + _ttRow('Sens',      p.sens)
    + _ttRow('Position',  p.position)
    + _ttRow('PK',        p.pk)
    + idRows;
}

function _ttRow(label, val) {
  if (!val) return '';
  return `<div class="tt-row"><span class="tt-key">${label}</span>${val}</div>`;
}

/* ===== Popup state ===== */

let _popup    = null;
let _statuses = null;   // array of { status, nodeId } per feat, or null while loading

export function openSignalPopup(latlng, feats, idx = 0) {
  if (_popup) { _popup.remove(); _popup = null; }
  _statuses = null;

  _popup = L.popup({
    maxWidth: 360, autoPan: true, closeButton: false, className: 'pu-leaflet',
  }).setLatLng(latlng).setContent(_build(feats, idx)).openOn(map);

  // Launch OSM checks in parallel; refresh popup content once resolved
  Promise.all(feats.map(f => checkOsm(f.p.idreseau, f.p.type_if))).then(results => {
    _statuses = results;
    if (_popup?.isOpen()) _popup.setContent(_build(feats, idx));
  });

  _popup.getElement()?.addEventListener('click', e => {
    if (e.target.closest('[data-action="close"]')) {
      _popup?.remove(); _popup = null; return;
    }
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      e.stopPropagation();
      let next = parseInt(nav.dataset.nav);
      if (next < 0)             next = feats.length - 1;
      if (next >= feats.length) next = 0;
      _popup.setContent(_build(feats, next));
      return;
    }
    if (e.target.closest('[data-action="copy"]'))
      _copyTags(feats, e.target.closest('[data-action="copy"]'));
    if (e.target.closest('[data-action="josm"]'))
      _sendToJOSM(feats, latlng, e.target.closest('[data-action="josm"]'));
  });
}

/* ===== Popup HTML ===== */

function _build(feats, idx) {
  const s       = feats[idx];
  const p       = s.p;
  const total   = feats.length;
  const color   = getTypeColor(p.type_if);
  const osmInfo = _statuses?.[idx] ?? { status: 'checking', nodeId: null };

  const nav = `
    <div class="pu-nav">
      <div class="pu-nav-left">
        ${total > 1
          ? `<button class="pu-nav-btn" data-nav="${idx - 1}">&#8249;</button>`
          : '<span class="pu-nav-placeholder"></span>'}
        <span class="pu-nav-label">${total > 1 ? `${idx + 1} / ${total}` : '&nbsp;'}</span>
        ${total > 1
          ? `<button class="pu-nav-btn" data-nav="${idx + 1}">&#8250;</button>`
          : '<span class="pu-nav-placeholder"></span>'}
      </div>
      <button class="pu-close-btn" data-action="close">&#10005;</button>
    </div>`;

  // Field order: type, line, track code, track name, direction, position, PK
  const FIELDS = [
    ['type_if','TYPE IF'], ['code_ligne','CODE LIGNE'],
    ['code_voie','CODE VOIE'], ['nom_voie','NOM VOIE'],
    ['sens','SENS'], ['position','POSITION'], ['pk','PK'],
  ];
  const rows = FIELDS.map(([f, label]) => {
    const val = p[f]; if (!val && val !== 0) return '';
    const display = f === 'type_if'
      ? `<span class="pu-badge" style="background:${color}">${val}</span>`
      : `<span class="pu-val">${val}</span>`;
    return `<div class="pu-row"><span class="pu-label">${label}</span>${display}</div>`;
  }).join('');

  // ID réseau row with inline OSM indicator
  const idRow = p.idreseau ? `
    <div class="pu-row">
      <span class="pu-label">ID RÉSEAU</span>
      <span class="pu-val">${p.idreseau}</span>
      ${_osmIndicator(osmInfo)}
    </div>` : '';

  const coord = `<div class="pu-row">
    <span class="pu-label">COORDS</span>
    <span class="pu-val" style="font-size:10px">${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}</span>
  </div>`;

  // OSM tags collapsible section (supported types only)
  let osmSection = '';
  if (isSupported(p.type_if)) {
    const tagMap  = _buildOsmTags(feats);
    const osmRows = [...tagMap.entries()].map(([k,v]) => `
      <div class="pu-osm-row">
        <span class="pu-osm-key">${k}</span>
        <span class="pu-osm-val${v === '*' ? ' pu-osm-unknown' : ''}">${v}</span>
      </div>`).join('');
    const note = total > 1
      ? `<div class="pu-osm-note">${t('popup.merged', total)}</div>` : '';
    osmSection = `
      <details class="pu-osm-preview">
        <summary>${t('popup.osmTags', total)}</summary>
        <div class="pu-osm-scroll">${note}<div class="pu-osm-list">${osmRows}</div></div>
      </details>`;
  }

  const footer = `
    <div class="pu-footer">
      <button class="pu-action-btn" data-action="copy" title="${t('popup.copy')}">
        ${_svgCopy()} ${t('popup.copy')}
      </button>
      <button class="pu-action-btn pu-josm-btn" data-action="josm"
              title="${t('popup.josm')} (127.0.0.1:8111)">
        <img src="assets/svg/josm.svg" width="14" height="14" alt=""
             style="vertical-align:-2px;flex-shrink:0">
        ${t('popup.josm')}
      </button>
    </div>`;

  return `<div class="pu-wrap">${nav}<div class="pu-body">${rows}${idRow}${coord}</div>${osmSection}${footer}</div>`;
}

/* OSM indicator rendered inline next to the ID réseau value */
function _osmIndicator({ status, nodeId }) {
  if (status === 'checking') {
    return `<span class="pu-osm-indicator osm-checking" title="${t('osm.checking')}">…</span>`;
  }
  if (status === 'in-osm' && nodeId) {
    const href = `https://www.openstreetmap.org/node/${nodeId}`;
    return `<a class="pu-osm-indicator" href="${href}" target="_blank" rel="noopener"
               title="${t('osm.inOsm')} — node #${nodeId}"
             ><img src="assets/svg/osm.svg" width="16" height="16" alt="OSM"
                   style="vertical-align:-3px"></a>`;
  }
  if (status === 'not-in-osm') {
    return `<span class="pu-osm-indicator" title="${t('osm.notInOsm')}"
            ><img src="assets/svg/osm.svg" width="16" height="16" alt=""
                  style="vertical-align:-3px;filter:grayscale(1) opacity(.3)"></span>`;
  }
  if (status === 'error') {
    return `<span class="pu-osm-indicator osm-error" title="${t('osm.error')}">?</span>`;
  }
  return '';
}

/* ===== Actions ===== */

function _copyTags(feats, btn) {
  navigator.clipboard.writeText(_tagsToText(_buildOsmTags(feats)))
    .then(() => _flash(btn, `${_svgCheck()} ${t('popup.copied')}`, '#4ade80', '#0b0e16'))
    .catch(()  => prompt('Copy OSM tags:', _tagsToText(_buildOsmTags(feats))));
}

function _sendToJOSM(feats, latlng, btn) {
  const alreadyInOsm = _statuses?.some(s => s.status === 'in-osm');
  if (alreadyInOsm) {
    const msg = feats.length > 1 ? t('osm.warnMulti') : t('osm.warnSingle');
    if (!confirm(msg)) return;
  }

  const tagMap  = _buildOsmTags(feats);
  const addtags = [...tagMap.entries()]
    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('|');
  const comment = encodeURIComponent('Import signalisation permanente SNCF');
  const url     = `http://127.0.0.1:8111/add_node?lat=${latlng[0]}&lon=${latlng[1]}&addtags=${addtags}&changeset_comment=${comment}`;

  const img = new Image();
  img.onload = img.onerror = () =>
    _flash(btn, `${_svgCheck()} ${t('popup.josmSent')}`, '#4ade80', '#0b0e16');
  img.src = url;
}

function _flash(btn, html, bg, fg) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.innerHTML = html; btn.style.background = bg; btn.style.color = fg;
  setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2400);
}

function _svgCopy() {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
}
function _svgCheck() {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>';
}

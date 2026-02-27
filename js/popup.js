/**
 * popup.js
 * Signal popup: data display, multi-signal navigation,
 * clipboard copy (OSM tags) and JOSM Remote Control integration.
 */

import { map } from './map.js';

const TYPE_COLORS = {
  'CARRE':       '#e8321e',
  'TIV D FIXE':  '#f5a623',
  'S':           '#4ade80',
  'ARRET VOY':   '#60a5fa',
  'Z':           '#c084fc',
  'CHEVRON':     '#fb923c',
  'PN':          '#facc15',
  'DISQUE':      '#f87171',
  'GUIDON ARR':  '#a3e635',
};

/** Returns OSM tags for a signal — empty values stripped. */
function _osmTags(s) {
  const p = s.p;
  const raw = {
    'railway':                   'signal',
    'ref:SNCF':                  p.idreseau,
    'railway:signal:direction':  p.sens,
    'railway:position':          p.pk,
    'railway:signal:type_if':    p.type_if,
    'railway:signal:code_ligne': p.code_ligne,
    'railway:signal:nom_voie':   p.nom_voie,
    'railway:signal:position':   p.position,
    'railway:signal:code_voie':  p.code_voie,
  };
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

export function getTypeColor(type) {
  return TYPE_COLORS[type] || '#94a3b8';
}

let _currentPopup = null;

export function openSignalPopup(latlng, feats, idx = 0) {
  if (_currentPopup) { _currentPopup.remove(); _currentPopup = null; }

  const popup = L.popup({ maxWidth: 340, autoPan: true, closeButton: true })
    .setLatLng(latlng)
    .setContent(_build(feats, idx))
    .openOn(map);

  _currentPopup = popup;

  popup.getElement()?.addEventListener('click', e => {
    const nav  = e.target.closest('[data-nav]');
    if (nav)  { popup.setContent(_build(feats, parseInt(nav.dataset.nav))); return; }

    const copy = e.target.closest('[data-action="copy"]');
    if (copy) { _copyTags(feats[parseInt(copy.dataset.idx)], copy); return; }

    const josm = e.target.closest('[data-action="josm"]');
    if (josm) { _sendToJOSM(feats[parseInt(josm.dataset.idx)], josm); }
  });
}

// ---- HTML builder ----

function _build(feats, idx) {
  const s     = feats[idx];
  const p     = s.p;
  const total = feats.length;
  const color = TYPE_COLORS[p.type_if] || '#94a3b8';

  const nav = total > 1 ? `
    <div class="pu-nav">
      <button class="pu-nav-btn" data-nav="${idx-1}" ${idx===0?'disabled':''}>&#8249;</button>
      <span class="pu-nav-label">Signal ${idx+1} / ${total}</span>
      <button class="pu-nav-btn" data-nav="${idx+1}" ${idx===total-1?'disabled':''}>&#8250;</button>
    </div>` : '';

  const fields = [
    ['type_if',    'TYPE IF'],
    ['code_ligne', 'CODE LIGNE'],
    ['nom_voie',   'NOM VOIE'],
    ['sens',       'SENS'],
    ['position',   'POSITION'],
    ['pk',         'PK'],
    ['code_voie',  'CODE VOIE'],
    ['idreseau',   'ID RÉSEAU'],
  ];

  const rows = fields.map(([f, label]) => {
    const val = p[f];
    if (!val && val !== 0) return '';
    const display = f === 'type_if'
      ? `<span class="pu-badge" style="background:${color}">${val}</span>`
      : `<span class="pu-val">${val}</span>`;
    return `<div class="pu-row"><span class="pu-label">${label}</span>${display}</div>`;
  }).join('');

  const coord = `<div class="pu-row">
    <span class="pu-label">COORDS</span>
    <span class="pu-val pu-mono">${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}</span>
  </div>`;

  return `
    <div class="pu-wrap">
      ${nav}
      <div class="pu-body">${rows}${coord}</div>
      <div class="pu-footer">
        <button class="pu-action-btn" data-action="copy" data-idx="${idx}"
          title="Copy OSM tags to clipboard (paste into JOSM tag editor)">
          ${_svgCopy()} Copy tags
        </button>
        <button class="pu-action-btn pu-josm-btn" data-action="josm" data-idx="${idx}"
          title="Add node directly in JOSM — requires Remote Control enabled in JOSM preferences">
          ${_svgJOSM()} Open in JOSM
        </button>
      </div>
    </div>`;
}

// ---- Copy OSM tags to clipboard ----
// Produces key=value lines, one per line — paste directly into JOSM tag panel.

function _copyTags(s, btn) {
  const tags = _osmTags(s);
  const text = Object.entries(tags).map(([k, v]) => `${k}=${v}`).join('\n');

  navigator.clipboard.writeText(text)
    .then(()  => _flash(btn, `${_svgCheck()} Copied!`, '#4ade80', '#0b0e16'))
    .catch(()  => prompt('Copy these OSM tags:', text));
}

// ---- JOSM Remote Control ----
// JOSM must be open with Edit → Preferences → Remote Control → Enable.
// Creates a new node at the signal coordinates with all OSM tags.

function _sendToJOSM(s, btn) {
  const tags    = _osmTags(s);
  const addtags = Object.entries(tags)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('|');

  const url = `http://localhost:8111/add_node?lat=${s.lat}&lon=${s.lng}&addtags=${addtags}`;

  // fetch with no-cors: response is opaque but the request reaches JOSM
  fetch(url, { mode: 'no-cors' })
    .then(() => _flash(btn, `${_svgCheck()} Sent to JOSM`, '#4ade80', '#0b0e16'))
    .catch(() => _flash(btn, '⚠ JOSM not reachable', '#f5a623', '#0b0e16'));
}

// ---- Helpers ----

function _flash(btn, html, bg, fg) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.innerHTML        = html;
  btn.style.background = bg;
  btn.style.color      = fg;
  setTimeout(() => {
    btn.innerHTML        = orig;
    btn.style.background = '';
    btn.style.color      = '';
  }, 2000);
}

function _svgCopy() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;flex-shrink:0">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`;
}

function _svgJOSM() {
  // Map-pin style icon representing JOSM
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;flex-shrink:0">
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>`;
}

function _svgCheck() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;
}

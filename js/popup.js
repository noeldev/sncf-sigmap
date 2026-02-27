/**
 * popup.js
 * Signal popup: display, multi-signal navigation,
 * OSM tag copy (OpenRailwayMap France spec), JOSM Remote Control.
 *
 * OSM tagging reference:
 *   https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

import { map } from './map.js';

const TYPE_COLORS = {
  'CARRE':        '#e8321e',
  'CARRE VIOLET': '#c084fc',
  'S':            '#4ade80',
  'A':            '#facc15',
  'TIV D FIXE':   '#f5a623',
  'TIV D MOB':    '#fb923c',
  'TIV PENDIS':   '#fbbf24',
  'ARRET VOY':    '#60a5fa',
  'ARRET TRAM':   '#60a5fa',
  'HEURTOIR':     '#94a3b8',
  'DISQUE':       '#f87171',
  'GUIDON ARR':   '#a3e635',
  'CHEVRON':      '#fb923c',
  'PN':           '#facc15',
  'Z':            '#c084fc',
  'ID':           '#94a3b8',
};

// ---- OSM tag mapping (OpenRailwayMap/Tagging_in_France) ----
// Maps SNCF type_if values to OSM railway:signal:main values
const TYPE_IF_TO_OSM = {
  'CARRE':        { main: 'carré',            form: 'light' },
  'CARRE VIOLET': { main: 'carré_violet',      form: 'light' },
  'S':            { main: 'sémaphore',         form: 'light' },
  'A':            { main: 'avertissement',     form: 'light' },
  'TIV D FIXE':   { main: 'tiv-d',            form: 'sign',  subtype: 'fixe' },
  'TIV D MOB':    { main: 'tiv-d',            form: 'sign',  subtype: 'mobile' },
  'TIV PENDIS':   { main: 'tiv-d',            form: 'sign',  subtype: 'pendisque' },
  'DISQUE':       { main: 'disque',           form: 'light' },
  'GUIDON ARR':   { main: 'guidon_d_arrêt',   form: 'light' },
  'ARRET VOY':    { main: 'arrêt_à_main',     form: 'sign'  },
  'CHEVRON':      { main: 'chevron',          form: 'sign'  },
  'PN':           { main: 'passage_à_niveau', form: 'sign'  },
  'Z':            { main: 'tableau_z',        form: 'sign'  },
  'ID':           { main: 'indicateur_de_direction', form: 'sign' },
};

// SNCF sens → OSM railway:signal:direction
const SENS_TO_OSM = {
  'C': 'forward',
  'D': 'backward',
  'I': 'both',
};

export function getTypeColor(type) {
  return TYPE_COLORS[type] || '#94a3b8';
}

/** Builds the OSM tag set for a signal per ORM France spec. */
function _osmTags(s) {
  const p      = s.p;
  const mapped = TYPE_IF_TO_OSM[p.type_if];

  const tags = {
    'railway':                   'signal',
    'operator':                  'SNCF',
  };

  if (mapped) {
    tags['railway:signal:main']  = mapped.main;
    tags['railway:signal:main:form'] = mapped.form;
    if (mapped.subtype) tags['railway:signal:main:subtype'] = mapped.subtype;
  }

  // Direction: SNCF sens field → OSM direction value
  const dir = SENS_TO_OSM[p.sens] || p.sens;
  if (dir) tags['railway:signal:direction'] = dir;

  // Position along track
  if (p.pk)       tags['railway:position']      = p.pk;
  if (p.position) tags['railway:signal:position'] = p.position;

  // Line reference
  if (p.code_ligne) tags['ref:ligne']  = p.code_ligne;
  if (p.nom_voie)   tags['ref:voie']   = p.nom_voie;
  if (p.code_voie)  tags['ref:voie:code'] = p.code_voie;

  // SNCF internal reference
  if (p.idreseau)   tags['ref:SNCF']   = p.idreseau;

  // Remove empty values
  return Object.fromEntries(
    Object.entries(tags).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

let _currentPopup = null;

export function openSignalPopup(latlng, feats, idx = 0) {
  if (_currentPopup) { _currentPopup.remove(); _currentPopup = null; }

  const popup = L.popup({ maxWidth: 350, autoPan: true, closeButton: true })
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

  // OSM tags preview
  const osmTags  = _osmTags(s);
  const osmRows  = Object.entries(osmTags)
    .map(([k, v]) => `<div class="pu-osm-row"><span class="pu-osm-key">${k}</span><span class="pu-osm-val">${v}</span></div>`)
    .join('');

  return `
    <div class="pu-wrap">
      ${nav}
      <div class="pu-body">
        ${rows}
        ${coord}
      </div>
      <details class="pu-osm-preview">
        <summary>OSM tags preview</summary>
        <div class="pu-osm-list">${osmRows}</div>
      </details>
      <div class="pu-footer">
        <button class="pu-action-btn" data-action="copy" data-idx="${idx}"
          title="Copy OSM tags — paste into JOSM tag editor">
          ${_svgCopy()} Copy tags
        </button>
        <button class="pu-action-btn pu-josm-btn" data-action="josm" data-idx="${idx}"
          title="Send node to JOSM via Remote Control (must be enabled in JOSM preferences)">
          ${_svgJOSM()} Open in JOSM
        </button>
      </div>
    </div>`;
}

// ---- Copy tags: key=value lines, paste into JOSM tag panel ----

function _copyTags(s, btn) {
  const text = Object.entries(_osmTags(s))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  navigator.clipboard.writeText(text)
    .then(()  => _flash(btn, `${_svgCheck()} Copied!`, '#4ade80', '#0b0e16'))
    .catch(()  => prompt('Copy OSM tags:', text));
}

// ---- JOSM Remote Control ----

function _sendToJOSM(s, btn) {
  const tags    = _osmTags(s);
  const addtags = Object.entries(tags)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('|');

  const url = `http://localhost:8111/add_node?lat=${s.lat}&lon=${s.lng}&addtags=${addtags}`;

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
  setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2000);
}

function _svgCopy() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}
function _svgJOSM() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;flex-shrink:0"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
}
function _svgCheck() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>`;
}

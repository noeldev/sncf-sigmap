/**
 * popup.js
 * Signal popup: display, multi-signal navigation,
 * OSM tag generation, clipboard copy, JOSM Remote Control.
 */

import { map } from './map.js';
import { SIGNAL_MAPPING, FIELD_CONVERTERS, COMMON_TAGS } from './signal-mapping.js';

const TYPE_COLORS = {
  'CARRE':      '#e8321e', 'CV':         '#c084fc',
  'S':          '#4ade80', 'DISQUE':     '#f87171',
  'A':          '#facc15', 'DA':         '#eab308',
  'GA':         '#a3e635', 'TIV D FIXE': '#f5a623',
  'TIV D MOB':  '#fb923c', 'TIV PENDIS': '#fbbf24',
  'TIV PENEXE': '#f97316', 'TIV PENREP': '#fdba74',
  'TIV R MOB':  '#fed7aa', 'Z':          '#c084fc',
  'R':          '#a78bfa', 'ARRET VOY':  '#60a5fa',
  'HEURTOIR':   '#94a3b8', 'ID':         '#38bdf8',
  'IDD':        '#a78bfa', 'CHEVRON':    '#fb923c',
  'PN':         '#facc15',
};

export function getTypeColor(type) { return TYPE_COLORS[type] || '#94a3b8'; }

// Resolve a "key=value" template string with signal data
function _resolve(template, p) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, field) => {
    const conv = FIELD_CONVERTERS[field];
    return conv ? conv(p[field] ?? '') : (p[field] ?? '');
  });
}

function _parseTag(str) {
  const eq = str.indexOf('=');
  return eq < 0 ? [str, ''] : [str.slice(0, eq), str.slice(eq + 1)];
}

// Build OSM tags for a single signal (type-specific tags only, no common tags)
function _resolveOne(s) {
  const tags   = new Map();
  const tmpls  = SIGNAL_MAPPING[s.p.type_if];
  if (tmpls) {
    for (const tmpl of tmpls) {
      const [k, v] = _parseTag(_resolve(tmpl, s.p));
      if (k) tags.set(k, v);
    }
  } else {
    tags.set('note:SNCF:type_if', s.p.type_if || 'unknown');
  }
  return tags;
}

// Build merged OSM tags for one or more co-located signals
function _buildOsmTags(feats) {
  const merged = new Map();

  // Common tags resolved from the first signal (pk, sens, position are shared)
  for (const tmpl of COMMON_TAGS) {
    const [k, v] = _parseTag(_resolve(tmpl, feats[0].p));
    if (k) merged.set(k, v);
  }

  // Per-signal type-specific tags (all signals contribute their own tags)
  for (const feat of feats) {
    for (const [k, v] of _resolveOne(feat)) {
      merged.set(k, v);
    }
  }

  // Line reference from first signal
  if (feats[0].p.code_ligne) merged.set('ref:ligne', feats[0].p.code_ligne);

  return merged;
}

function _tagsToText(tagMap) {
  return [...tagMap.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
}

// Popup

let _currentPopup = null;

export function openSignalPopup(latlng, feats, idx = 0) {
  if (_currentPopup) { _currentPopup.remove(); _currentPopup = null; }

  const popup = L.popup({ maxWidth: 360, autoPan: true, closeButton: true })
    .setLatLng(latlng)
    .setContent(_build(feats, idx))
    .openOn(map);

  _currentPopup = popup;

  popup.getElement()?.addEventListener('click', e => {
    const nav  = e.target.closest('[data-nav]');
    if (nav)  { popup.setContent(_build(feats, parseInt(nav.dataset.nav))); return; }

    if (e.target.closest('[data-action="copy"]')) { _copyAll(feats, e.target.closest('[data-action="copy"]')); return; }
    if (e.target.closest('[data-action="josm"]')) { _sendToJOSM(feats, latlng, e.target.closest('[data-action="josm"]')); }
  });
}

function _build(feats, idx) {
  const s     = feats[idx];
  const p     = s.p;
  const total = feats.length;
  const color = getTypeColor(p.type_if);

  const nav = total > 1 ? `
    <div class="pu-nav">
      <button class="pu-nav-btn" data-nav="${idx-1}" ${idx===0?'disabled':''}>&#8249;</button>
      <span class="pu-nav-label">Signal ${idx+1} / ${total}</span>
      <button class="pu-nav-btn" data-nav="${idx+1}" ${idx===total-1?'disabled':''}>&#8250;</button>
    </div>` : '';

  const fields = [
    ['type_if','TYPE IF'], ['code_ligne','CODE LIGNE'], ['nom_voie','NOM VOIE'],
    ['sens','SENS'],       ['position','POSITION'],      ['pk','PK'],
    ['code_voie','CODE VOIE'], ['idreseau','ID RÉSEAU'],
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

  const tagMap  = _buildOsmTags(feats);
  const osmRows = [...tagMap.entries()].map(([k, v]) =>
    `<div class="pu-osm-row">
      <span class="pu-osm-key">${k}</span>
      <span class="pu-osm-val${v==='*'?' pu-osm-unknown':''}">${v}</span>
    </div>`).join('');

  const mergeNote = total > 1
    ? `<div class="pu-osm-note">Tags merged for ${total} co-located signals</div>` : '';

  return `
    <div class="pu-wrap">
      ${nav}
      <div class="pu-body">${rows}${coord}</div>
      <details class="pu-osm-preview">
        <summary>OSM tags${total > 1 ? ` (${total} signals)` : ''}</summary>
        ${mergeNote}
        <div class="pu-osm-list">${osmRows}</div>
      </details>
      <div class="pu-footer">
        <button class="pu-action-btn" data-action="copy"
          title="Copy OSM tags to clipboard">
          ${_svgCopy()}
        </button>
        <button class="pu-action-btn pu-josm-btn" data-action="josm"
          title="Export OSM tags to JOSM via Remote Control">
          <img src="assets/svg/josm.svg" width="20" height="20" alt="JOSM"
               style="vertical-align:middle;flex-shrink:0">
        </button>
      </div>
    </div>`;
}

function _copyAll(feats, btn) {
  const text = _tagsToText(_buildOsmTags(feats));
  navigator.clipboard.writeText(text)
    .then(()  => _flash(btn, `${_svgCheck()} Copied!`, '#4ade80', '#0b0e16'))
    .catch(()  => prompt('Copy OSM tags:', text));
}

function _sendToJOSM(feats, latlng, btn) {
  const tagMap  = _buildOsmTags(feats);
  const addtags = [...tagMap.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('|');
  const comment = encodeURIComponent('Import signalisation permanente SNCF');
  const url     = `http://localhost:8111/add_node?lat=${latlng[0]}&lon=${latlng[1]}&addtags=${addtags}&changeset_comment=${comment}`;

  fetch(url, { mode: 'no-cors' })
    .then(() => _flash(btn, `${_svgCheck()} Sent to JOSM`, '#4ade80', '#0b0e16'))
    .catch(() => _flash(btn, '&#9888; JOSM not reachable', '#f5a623', '#0b0e16'));
}

function _flash(btn, html, bg, fg) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.innerHTML = html; btn.style.background = bg; btn.style.color = fg;
  setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2000);
}
function _svgCopy() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}
function _svgCheck() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>`;
}

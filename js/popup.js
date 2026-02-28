/**
 * popup.js
 * Signal popup — display, multi-signal navigation,
 * OSM tag generation (signal-mapping.js), clipboard copy, JOSM Remote Control.
 */

import { map }                                          from './map.js';
import { SIGNAL_MAPPING, FIELD_CONVERTERS, SHARED_TAG_KEYS } from './signal-mapping.js';

const TYPE_COLORS = {
  'CARRE':        '#e8321e', 'CARRE VIOLET': '#c084fc',
  'S':            '#4ade80', 'DISQUE':       '#f87171',
  'A':            '#facc15', 'GUIDON ARR':   '#a3e635',
  'TIV D FIXE':   '#f5a623', 'TIV D MOB':   '#fb923c',
  'TIV PENDIS':   '#fbbf24', 'TIV EXEC':    '#f97316',
  'ARRET VOY':    '#60a5fa', 'ARRET TRAM':  '#38bdf8',
  'HEURTOIR':     '#94a3b8', 'IDD':         '#a78bfa',
  'CHEVRON':      '#fb923c', 'PN':          '#facc15',
  'Z':            '#c084fc', 'ID':          '#94a3b8',
};

export function getTypeColor(type) { return TYPE_COLORS[type] || '#94a3b8'; }

// ── Tag resolution ────────────────────────────────────────────────────────

/** Resolve a single template string "key=value" with signal data. */
function _resolve(template, p) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, field) => {
    const raw  = p[field] ?? '';
    const conv = FIELD_CONVERTERS[field];
    return conv ? conv(raw) : raw;
  });
}

/** Parse "key=value" string into [key, value]. */
function _parseTag(str) {
  const eq = str.indexOf('=');
  return eq < 0 ? [str, ''] : [str.slice(0, eq), str.slice(eq + 1)];
}

/**
 * Build merged OSM tags for one or more co-located signals.
 * Shared tags (position, direction, etc.) appear once.
 * Per-signal tags are each included, with idreseau disambiguating refs.
 */
function _buildOsmTags(feats) {
  if (feats.length === 1) return _resolveOne(feats[0]);

  // Multi-signal: collect per-signal tag lists, then merge
  const perSignal = feats.map(s => _resolveOne(s));

  const merged = new Map();

  // First pass: add shared tags (same key AND same value across all signals)
  for (const [key, val] of perSignal[0]) {
    if (!SHARED_TAG_KEYS.has(key)) continue;
    const allSame = perSignal.every(m => m.get(key) === val);
    if (allSame) merged.set(key, val);
  }

  // Second pass: add per-signal tags that are NOT shared
  for (const tagMap of perSignal) {
    for (const [key, val] of tagMap) {
      if (merged.has(key)) continue;   // already added as shared
      if (SHARED_TAG_KEYS.has(key)) continue;
      // If key already exists from another signal, it stays (last-write wins for same key)
      merged.set(key, val);
    }
  }

  // Always add source
  merged.set('source', 'SNCF - 03/2022');

  return merged;
}

/** Resolve mapping for a single signal → Map<key,value>. */
function _resolveOne(s) {
  const p       = s.p;
  const tmplArr = SIGNAL_MAPPING[p.type_if];
  const result  = new Map();

  if (tmplArr) {
    for (const tmpl of tmplArr) {
      const resolved    = _resolve(tmpl, p);
      const [key, val]  = _parseTag(resolved);
      if (key) result.set(key, val);
    }
  } else {
    // Unknown type — emit minimal tags
    result.set('railway', 'signal');
    result.set('railway:position:exact', _resolve('{{pk}}', p));
    result.set('railway:signal:direction', _resolve('{{sens}}', p));
    result.set('note:SNCF:type_if', p.type_if || '');
  }

  // Always include SNCF line reference
  if (p.code_ligne) result.set('ref:ligne', p.code_ligne);

  return result;
}

/** Format Map<key,value> as "key=value\n..." string for clipboard. */
function _tagsToText(tagMap) {
  return [...tagMap.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
}

// ── Popup ─────────────────────────────────────────────────────────────────

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

    const copy = e.target.closest('[data-action="copy"]');
    if (copy) { _copyAll(feats, copy); return; }

    const josm = e.target.closest('[data-action="josm"]');
    if (josm) { _sendToJOSM(feats, latlng, josm); }
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
    ['sens','SENS'], ['position','POSITION'], ['pk','PK'],
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

  // OSM preview shows the merged result for all co-located signals
  const tagMap  = _buildOsmTags(feats);
  const osmRows = [...tagMap.entries()]
    .map(([k, v]) => `<div class="pu-osm-row">
      <span class="pu-osm-key">${k}</span>
      <span class="pu-osm-val${v==='*'?' pu-osm-unknown':''}">${v}</span>
    </div>`).join('');

  const osmNote = total > 1
    ? `<div class="pu-osm-note">Merged tags for all ${total} co-located signals</div>` : '';

  return `
    <div class="pu-wrap">
      ${nav}
      <div class="pu-body">${rows}${coord}</div>
      <details class="pu-osm-preview">
        <summary>OSM tags${total>1?` (${total} signals merged)`:''}</summary>
        ${osmNote}
        <div class="pu-osm-list">${osmRows}</div>
      </details>
      <div class="pu-footer">
        <button class="pu-action-btn" data-action="copy" title="Copy merged OSM tags to clipboard">
          ${_svgCopy()} Copy tags
        </button>
        <button class="pu-action-btn pu-josm-btn" data-action="josm"
          title="Add node in JOSM via Remote Control (enable in JOSM Preferences)">
          <img src="./josm.svg" width="14" height="14" alt="JOSM" style="vertical-align:-2px;flex-shrink:0"> Open in JOSM
        </button>
      </div>
    </div>`;
}

// ── Copy all merged tags to clipboard ─────────────────────────────────────

function _copyAll(feats, btn) {
  const text = _tagsToText(_buildOsmTags(feats));
  navigator.clipboard.writeText(text)
    .then(()  => _flash(btn, `${_svgCheck()} Copied!`, '#4ade80', '#0b0e16'))
    .catch(()  => prompt('Copy OSM tags:', text));
}

// ── JOSM Remote Control ───────────────────────────────────────────────────
// Creates a node at the signal location with all merged OSM tags.
// Changeset comment is pre-filled for the OSM upload dialog.

function _sendToJOSM(feats, latlng, btn) {
  const tagMap  = _buildOsmTags(feats);
  const addtags = [...tagMap.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('|');

  const comment = encodeURIComponent('Import signalisation permanente SNCF');
  const url     = `http://localhost:8111/add_node?lat=${latlng[0]}&lon=${latlng[1]}&addtags=${addtags}&changeset_comment=${comment}`;

  fetch(url, { mode: 'no-cors' })
    .then(() => _flash(btn, `${_svgCheck()} Sent to JOSM`, '#4ade80', '#0b0e16'))
    .catch(() => _flash(btn, '⚠ JOSM not reachable', '#f5a623', '#0b0e16'));
}

// ── Helpers ───────────────────────────────────────────────────────────────

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

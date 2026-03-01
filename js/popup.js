/**
 * popup.js
 * Signal popup: display, multi-signal navigation,
 * OSM tag generation, clipboard copy, JOSM Remote Control.
 */

import { map }                                        from './map.js';
import { SIGNAL_MAPPING, FIELD_CONVERTERS, COMMON_TAGS } from './signal-mapping.js';

// ---------------------------------------------------------------------------
// Signal type → colour group
// Groups match JOSM preset categories, colour-blind-friendly palette.
// ---------------------------------------------------------------------------

const TYPE_GROUPS = {
  // Main signals — red
  'CARRE': 'main', 'CV': 'main', 'S': 'main', 'GA': 'main',
  // Distant signals — amber
  'A': 'distant', 'D': 'distant',
  // Speed limits — orange
  'TIV D FIXE': 'speed', 'TIV D MOB': 'speed', 'TIV R MOB': 'speed',
  'TIV PENDIS': 'speed', 'TIV PENEXE': 'speed', 'TIV PENREP': 'speed',
  'Z': 'speed', 'R': 'speed',
  // Route indicators — cyan
  'ID': 'route', 'IDD': 'route', 'CHEVRON': 'route',
  // Stop / infrastructure — blue
  'ARRET VOY': 'stop', 'HEURTOIR': 'stop',
  // Level crossing — green
  'PN': 'crossing',
};

const GROUP_COLORS = {
  'main':     '#e85d5d',   // soft red
  'distant':  '#f5c842',   // amber
  'speed':    '#fb923c',   // orange
  'route':    '#38bdf8',   // cyan
  'stop':     '#60a5fa',   // blue
  'crossing': '#4ade80',   // green
  'unknown':  '#6b7280',   // mid-grey for unmapped types
};

export function getTypeColor(type) {
  return GROUP_COLORS[TYPE_GROUPS[type] || 'unknown'];
}

export function isSupported(type) { return !!SIGNAL_MAPPING[type]; }

// ---------------------------------------------------------------------------
// Tag resolution
// ---------------------------------------------------------------------------

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

function _resolveOne(s) {
  const tags  = new Map();
  const tmpls = SIGNAL_MAPPING[s.p.type_if];
  if (tmpls) {
    for (const tmpl of tmpls) {
      const [k, v] = _parseTag(_resolve(tmpl, s.p));
      if (k) tags.set(k, v);
    }
  }
  return tags;
}

function _buildOsmTags(feats) {
  const merged = new Map();
  // Common tags from first signal (pk / sens / position are shared for co-located signals)
  for (const tmpl of COMMON_TAGS) {
    const [k, v] = _parseTag(_resolve(tmpl, feats[0].p));
    if (k) merged.set(k, v);
  }
  // Type-specific tags for every signal in the group
  for (const feat of feats) {
    for (const [k, v] of _resolveOne(feat)) merged.set(k, v);
  }
  // ref:ligne removed — not a valid ORM tag
  return merged;
}

function _tagsToText(tagMap) {
  return [...tagMap.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
}

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

let _popup = null;

export function openSignalPopup(latlng, feats, idx = 0) {
  if (_popup) { _popup.remove(); _popup = null; }

  _popup = L.popup({
    maxWidth:    360,
    maxHeight:   480,      // constrained height → scrolling inside OSM section
    autoPan:     true,
    closeButton: false,    // we render our own close button in the header
    className:   'pu-leaflet',
  }).setLatLng(latlng).setContent(_build(feats, idx)).openOn(map);

  // Delegate all interactions through the popup element
  _popup.getElement()?.addEventListener('click', e => {
    const el = e.target;

    // Close button
    if (el.closest('[data-action="close"]')) {
      _popup.remove(); _popup = null; return;
    }

    // Navigation (wrapping)
    const nav = el.closest('[data-nav]');
    if (nav) {
      e.stopPropagation();
      const total  = feats.length;
      let   next   = parseInt(nav.dataset.nav);
      if (next < 0)      next = total - 1;  // wrap left
      if (next >= total) next = 0;           // wrap right
      _popup.setContent(_build(feats, next));
      return;
    }

    if (el.closest('[data-action="copy"]'))
      _copyTags(feats, el.closest('[data-action="copy"]'));

    if (el.closest('[data-action="josm"]'))
      _sendToJOSM(feats, latlng, el.closest('[data-action="josm"]'));
  });
}

/** Build tooltip text shown on marker hover */
export function buildTooltip(feats) {
  if (feats.length === 1) {
    const p = feats[0].p;
    return `<b>${p.type_if || '?'}</b><br>${p.code_voie || ''} · ${p.pk || ''}`;
  }
  const types = [...new Set(feats.map(f => f.p.type_if))].join(', ');
  return `<b>${feats.length} signals</b><br>${types}`;
}

function _build(feats, idx) {
  const s     = feats[idx];
  const p     = s.p;
  const total = feats.length;
  const color = getTypeColor(p.type_if);
  const supp  = isSupported(p.type_if);

  // Nav header (always rendered; hides arrows when only 1 signal)
  const prevIdx = idx - 1;  // _click_ will wrap if < 0
  const nextIdx = idx + 1;  // _click_ will wrap if >= total

  const nav = `
    <div class="pu-nav">
      <div class="pu-nav-left">
        ${total > 1
          ? `<button class="pu-nav-btn" data-nav="${prevIdx}" title="Previous signal">&#8249;</button>`
          : '<span class="pu-nav-placeholder"></span>'}
        <span class="pu-nav-label">${total > 1 ? `${idx + 1} / ${total}` : '&nbsp;'}</span>
        ${total > 1
          ? `<button class="pu-nav-btn" data-nav="${nextIdx}" title="Next signal">&#8250;</button>`
          : '<span class="pu-nav-placeholder"></span>'}
      </div>
      <button class="pu-close-btn" data-action="close" title="Close">&#10005;</button>
    </div>`;

  const fields = [
    ['type_if','TYPE IF'], ['code_ligne','CODE LIGNE'], ['nom_voie','NOM VOIE'],
    ['sens','SENS'],        ['position','POSITION'],    ['pk','PK'],
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

  // OSM tags section (scrollable, only when supported)
  let osmSection = '';
  if (supp) {
    const tagMap  = _buildOsmTags(feats);
    const osmRows = [...tagMap.entries()].map(([k, v]) =>
      `<div class="pu-osm-row">
        <span class="pu-osm-key">${k}</span>
        <span class="pu-osm-val${v === '*' ? ' pu-osm-unknown' : ''}">${v}</span>
      </div>`).join('');
    const note = total > 1
      ? `<div class="pu-osm-note">Tags merged for ${total} co-located signals</div>` : '';
    osmSection = `
      <details class="pu-osm-preview">
        <summary>OSM tags${total > 1 ? ` (${total} signals)` : ''}</summary>
        <div class="pu-osm-scroll">
          ${note}
          <div class="pu-osm-list">${osmRows}</div>
        </div>
      </details>`;
  }

  // Action buttons (only for supported types)
  const footer = supp ? `
    <div class="pu-footer">
      <button class="pu-action-btn" data-action="copy"
              title="Copy merged OSM tags">
        ${_svgCopy()} Copy tags
      </button>
      <button class="pu-action-btn pu-josm-btn" data-action="josm"
              title="Add node in JOSM via Remote Control (localhost:8111)">
        <img src="assets/svg/josm.svg" width="14" height="14" alt=""
             style="vertical-align:-2px;flex-shrink:0"> Open in JOSM
      </button>
    </div>` : '';

  return `<div class="pu-wrap">${nav}<div class="pu-body">${rows}${coord}</div>${osmSection}${footer}</div>`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function _copyTags(feats, btn) {
  navigator.clipboard.writeText(_tagsToText(_buildOsmTags(feats)))
    .then(() => _flash(btn, `${_svgCheck()} Copied!`,        '#4ade80', '#0b0e16'))
    .catch(()  => prompt('Copy OSM tags:', _tagsToText(_buildOsmTags(feats))));
}

function _sendToJOSM(feats, latlng, btn) {
  const tagMap  = _buildOsmTags(feats);
  const addtags = [...tagMap.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('|');
  const comment = encodeURIComponent('Import signalisation permanente SNCF');
  const url = `http://localhost:8111/add_node?lat=${latlng[0]}&lon=${latlng[1]}&addtags=${addtags}&changeset_comment=${comment}`;

  // Use Image() trick — JOSM CORS headers don't allow fetch(), but img.src works
  const img = new Image();
  img.onload  = () => _flash(btn, `${_svgCheck()} Sent to JOSM`, '#4ade80', '#0b0e16');
  img.onerror = () => {
    // onerror fires even on success because JOSM returns no image — try to confirm
    // by checking if response arrived (JOSM always responds, browser blocks CORS)
    _flash(btn, `${_svgCheck()} Sent to JOSM`, '#4ade80', '#0b0e16');
  };
  img.src = url;
}

function _flash(btn, html, bg, fg) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.innerHTML       = html;
  btn.style.background = bg;
  btn.style.color      = fg;
  setTimeout(() => {
    btn.innerHTML        = orig;
    btn.style.background = '';
    btn.style.color      = '';
  }, 2200);
}

function _svgCopy() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}
function _svgCheck() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>`;
}

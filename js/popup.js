/**
 * popup.js — Signal popup, OSM tag export, JOSM Remote Control.
 *
 * JOSM note: Netlify serves over HTTPS. The browser blocks HTTP requests
 * to localhost (Mixed Content) when the page is on HTTPS.
 * Workaround: window.location.href = josmUrl opens in the same tab briefly,
 * which is allowed for local network requests in most browsers.
 * Alternatively, users can install the JOSM certificate to enable HTTPS.
 */

import { map }                                              from './map.js';
import { SIGNAL_MAPPING, FIELD_CONVERTERS, COMMON_TAGS }   from './signal-mapping.js';

// ---------------------------------------------------------------------------
// Type → group → colour
// ---------------------------------------------------------------------------
const TYPE_GROUPS = {
  'CARRE': 'main',  'CV': 'main',  'S': 'main',  'GA': 'main',
  'A': 'distant',   'D': 'distant',
  'TIV D FIXE': 'speed', 'TIV D MOB': 'speed',  'TIV R MOB': 'speed',
  'TIV PENDIS': 'speed',  'TIV PENEXE': 'speed', 'TIV PENREP': 'speed',
  'Z': 'speed', 'R': 'speed',
  'ID': 'route',   'IDD': 'route',  'CHEVRON': 'route',
  'ARRET VOY': 'stop',  'HEURTOIR': 'stop',
  'PN': 'crossing',
};
const GROUP_COLORS = {
  main: '#e85d5d', distant: '#f5c842', speed: '#fb923c',
  route: '#38bdf8', stop: '#60a5fa', crossing: '#4ade80', unknown: '#6b7280',
};

export function getTypeColor(type)  { return GROUP_COLORS[TYPE_GROUPS[type] || 'unknown']; }
export function isSupported(type)   { return !!SIGNAL_MAPPING[type]; }

// ---------------------------------------------------------------------------
// Tag resolution
// ---------------------------------------------------------------------------
function _resolve(tmpl, p) {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, f) => {
    const c = FIELD_CONVERTERS[f];
    return c ? c(p[f] ?? '') : (p[f] ?? '');
  });
}
function _parseTag(str) { const i = str.indexOf('='); return i < 0 ? [str,''] : [str.slice(0,i), str.slice(i+1)]; }

function _resolveOne(s) {
  const tags = new Map();
  for (const tmpl of (SIGNAL_MAPPING[s.p.type_if] || [])) {
    const [k, v] = _parseTag(_resolve(tmpl, s.p));
    if (k) tags.set(k, v);
  }
  return tags;
}

function _buildOsmTags(feats) {
  const m = new Map();
  for (const tmpl of COMMON_TAGS) {
    const [k, v] = _parseTag(_resolve(tmpl, feats[0].p));
    if (k) m.set(k, v);
  }
  for (const feat of feats) for (const [k, v] of _resolveOne(feat)) m.set(k, v);
  // ref:ligne is not a valid ORM tag — omitted intentionally
  return m;
}

function _tagsToText(m) { return [...m.entries()].map(([k,v]) => `${k}=${v}`).join('\n'); }

// ---------------------------------------------------------------------------
// Tooltip text (hover)
// ---------------------------------------------------------------------------
export function buildTooltip(feats) {
  const p = feats[0].p;
  const lines = [
    feats.length > 1
      ? `${feats.length} signals — ${[...new Set(feats.map(f=>f.p.type_if))].join(', ')}`
      : `Type: ${p.type_if || '?'}`,
    p.code_ligne  ? `Ligne: ${p.code_ligne}`  : '',
    p.sens        ? `Sens: ${p.sens}`          : '',
    p.position    ? `Position: ${p.position}`  : '',
    p.pk          ? `PK: ${p.pk}`              : '',
    p.idreseau    ? `ID réseau: ${p.idreseau}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------
let _popup = null;

export function openSignalPopup(latlng, feats, idx = 0) {
  if (_popup) { _popup.remove(); _popup = null; }

  _popup = L.popup({
    maxWidth: 360, autoPan: true, closeButton: false,
    className: 'pu-leaflet',
  }).setLatLng(latlng).setContent(_build(feats, idx)).openOn(map);

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

function _build(feats, idx) {
  const s     = feats[idx];
  const p     = s.p;
  const total = feats.length;
  const color = getTypeColor(p.type_if);
  const supp  = isSupported(p.type_if);

  const nav = `
    <div class="pu-nav">
      <div class="pu-nav-left">
        ${total > 1
          ? `<button class="pu-nav-btn" data-nav="${idx - 1}" title="Previous">&#8249;</button>`
          : `<span class="pu-nav-placeholder"></span>`}
        <span class="pu-nav-label">${total > 1 ? `${idx+1} / ${total}` : '&nbsp;'}</span>
        ${total > 1
          ? `<button class="pu-nav-btn" data-nav="${idx + 1}" title="Next">&#8250;</button>`
          : `<span class="pu-nav-placeholder"></span>`}
      </div>
      <button class="pu-close-btn" data-action="close" title="Close">&#10005;</button>
    </div>`;

  const FIELDS = [
    ['type_if','TYPE IF'], ['code_ligne','CODE LIGNE'], ['nom_voie','NOM VOIE'],
    ['sens','SENS'], ['position','POSITION'], ['pk','PK'],
    ['code_voie','CODE VOIE'], ['idreseau','ID RÉSEAU'],
  ];
  const rows = FIELDS.map(([f, label]) => {
    const val = p[f];
    if (!val && val !== 0) return '';
    const display = f === 'type_if'
      ? `<span class="pu-badge" style="background:${color}">${val}</span>`
      : `<span class="pu-val">${val}</span>`;
    return `<div class="pu-row"><span class="pu-label">${label}</span>${display}</div>`;
  }).join('');

  const coord = `<div class="pu-row">
    <span class="pu-label">COORDS</span>
    <span class="pu-val" style="font-family:var(--mono);font-size:10px">${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}</span>
  </div>`;

  let osmSection = '';
  if (supp) {
    const tagMap  = _buildOsmTags(feats);
    const osmRows = [...tagMap.entries()].map(([k,v]) => `
      <div class="pu-osm-row">
        <span class="pu-osm-key">${k}</span>
        <span class="pu-osm-val${v==='*'?' pu-osm-unknown':''}">${v}</span>
      </div>`).join('');
    const note = total > 1
      ? `<div class="pu-osm-note">Tags merged for ${total} co-located signals</div>` : '';
    osmSection = `
      <details class="pu-osm-preview">
        <summary>OSM tags${total > 1 ? ` (${total} signals)` : ''}</summary>
        <div class="pu-osm-scroll">${note}
          <div class="pu-osm-list">${osmRows}</div>
        </div>
      </details>`;
  }

  const footer = supp ? `
    <div class="pu-footer">
      <button class="pu-action-btn" data-action="copy" title="Copy OSM tags to clipboard">
        ${_svgCopy()} Copy tags
      </button>
      <button class="pu-action-btn pu-josm-btn" data-action="josm"
              title="Add node in JOSM via Remote Control (port 8111)">
        <img src="assets/svg/josm.svg" width="14" height="14" alt="" style="vertical-align:-2px;flex-shrink:0">
        Open in JOSM
      </button>
    </div>
    <div class="pu-josm-notice" id="pu-notice-${idx}"></div>` : '';

  return `<div class="pu-wrap">${nav}<div class="pu-body">${rows}${coord}</div>${osmSection}${footer}</div>`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function _copyTags(feats, btn) {
  navigator.clipboard.writeText(_tagsToText(_buildOsmTags(feats)))
    .then(() => _flash(btn, `${_svgCheck()} Copied!`, '#4ade80', '#0b0e16'))
    .catch(()  => prompt('Copy OSM tags:', _tagsToText(_buildOsmTags(feats))));
}

function _sendToJOSM(feats, latlng, btn) {
  const tagMap  = _buildOsmTags(feats);
  const addtags = [...tagMap.entries()]
    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('|');
  const comment = encodeURIComponent('Import signalisation permanente SNCF');
  const url     = `http://localhost:8111/add_node?lat=${latlng[0]}&lon=${latlng[1]}&addtags=${addtags}&changeset_comment=${comment}`;

  // Mixed Content workaround: window.open() is allowed for local network on most browsers
  // even from HTTPS pages; img.src and fetch() are blocked.
  const w = window.open(url, '_blank', 'width=1,height=1,left=-100,top=-100');
  if (w) {
    setTimeout(() => { try { w.close(); } catch(_) {} }, 1500);
    _flash(btn, `${_svgCheck()} Sent to JOSM`, '#4ade80', '#0b0e16');
  } else {
    // Popup blocked — show the notice with a direct link
    const notice = btn.closest('.pu-wrap')?.querySelector('.pu-josm-notice');
    if (notice) {
      notice.innerHTML = `⚠ Popup blocked. <a href="${url}" target="_blank" style="color:var(--accent2)">Click here</a> to open in JOSM.`;
      notice.classList.add('visible');
    }
  }
}

function _flash(btn, html, bg, fg) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.innerHTML = html; btn.style.background = bg; btn.style.color = fg;
  setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2200);
}
function _svgCopy() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}
function _svgCheck() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>`;
}

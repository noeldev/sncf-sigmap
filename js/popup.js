/**
 * popup.js
 * Signal popup: display, navigation, OSM tag export, JOSM Remote Control.
 *
 * JOSM URL encoding:
 *   The addtags parameter requires each "key=value" pair to be encoded as a unit,
 *   with pairs separated by encoded pipes. The full value must be URI-encoded:
 *   addtags=key%3Dvalue%7Ckey2%3Dvalue2
 *
 * JOSM / Mixed Content:
 *   Browsers allow HTTP to 127.0.0.1 (not "localhost") from HTTPS pages in
 *   Firefox and Chrome. fetch() works correctly here — there is no need for
 *   the Image() workaround once the encoding is correct.
 */

import { map }                                                                   from './map.js';
import { SIGNAL_MAPPING, FIELD_CONVERTERS, COMMON_TAGS,
         getTypeColor, getTypeCategory, CATEGORY_COLORS, isSupported }           from './signal-mapping.js';
import { t }                                                                     from './i18n.js';
import { checkOsm }                                                              from './osm-check.js';

export { getTypeColor };

// Display categories whose background colour is light — use dark badge text
const LIGHT_CATEGORIES = new Set([
  'distant',       // yellow
  'speed_limit',   // orange — still light enough to need dark text
  'crossing',      // green
  'station',       // grey-blue (borderline)
  'miscellaneous', // slate
]);

/* ===== Tag resolution ===== */

function _resolve(tmpl, p) {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, f) => {
    const c = FIELD_CONVERTERS[f]; return c ? c(p[f] ?? '') : (p[f] ?? '');
  });
}
function _parseTag(s) { const i = s.indexOf('='); return i < 0 ? [s,''] : [s.slice(0,i), s.slice(i+1)]; }

function _resolveOne(feat) {
  const tags = new Map();
  for (const tmpl of (SIGNAL_MAPPING[feat.p.type_if]?.tags || [])) {
    const [k, v] = _parseTag(_resolve(tmpl, feat.p)); if (k) tags.set(k, v);
  }
  return tags;
}

function _buildOsmTags(feats) {
  // Only include signals of supported types
  const supported = feats.filter(f => isSupported(f.p.type_if));
  if (!supported.length) return new Map();
  const m = new Map();
  for (const tmpl of COMMON_TAGS) {
    const [k, v] = _parseTag(_resolve(tmpl, supported[0].p)); if (k) m.set(k, v);
  }
  for (const feat of supported) for (const [k, v] of _resolveOne(feat)) m.set(k, v);
  return m;
}

function _tagsToText(m) { return [...m.entries()].map(([k,v]) => `${k}=${v}`).join('\n'); }

/* ===== Tooltip ===== */

export function buildTooltip(feats) {
  const p = feats[0].p;

  // Signal rows: one per signal — type_if on the left, idreseau on the right
  const sigRows = feats.map(f => {
    const color = getTypeColor(f.p.type_if);
    const id    = f.p.idreseau
      ? `<span class="tt-val tt-id">${f.p.idreseau}</span>`
      : '<span class="tt-val tt-id"></span>';
    return `<div class="tt-row tt-sig">
      <span class="tt-type" style="color:${color}">${f.p.type_if || '?'}</span>${id}
    </div>`;
  }).join('');

  // Common properties shared by all signals at this location
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
  return `<div class="tt-row"><span class="tt-key">${label}</span>${val}</div>`;
}

/* ===== Popup state ===== */

let _popup    = null;
let _statuses = null;

export function openSignalPopup(latlng, feats, idx = 0) {
  if (_popup) { _popup.remove(); _popup = null; }
  _statuses = null;

  _popup = L.popup({
    maxWidth: 360, autoPan: true, closeButton: false, className: 'pu-leaflet',
  }).setLatLng(latlng).setContent(_build(feats, idx)).openOn(map);

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
    if (e.target.closest('[data-action="osm-retry"]')) {
      // Re-run OSM check for all signals and refresh popup
      _statuses = null;
      if (_popup?.isOpen()) _popup.setContent(_build(feats, idx));
      Promise.all(feats.map(f => checkOsm(f.p.idreseau, f.p.type_if, true))).then(results => {
        _statuses = results;
        if (_popup?.isOpen()) _popup.setContent(_build(feats, idx));
      });
    }
  });
}

/* ===== Popup HTML ===== */

function _build(feats, idx) {
  const s       = feats[idx];
  const p       = s.p;
  const total   = feats.length;
  const color   = getTypeColor(p.type_if);
  const osmInfo = _statuses?.[idx] ?? { status: 'checking', nodeId: null };
  const anySupported = feats.some(f => isSupported(f.p.type_if));

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

  // Use dark text on light-background category colours
  const badgeTextColor = LIGHT_CATEGORIES.has(getTypeCategory(p.type_if)) ? '#0d1117' : '#fff';

  const FIELDS = [
    ['type_if','TYPE IF'], ['code_ligne','CODE LIGNE'],
    ['code_voie','CODE VOIE'], ['nom_voie','NOM VOIE'],
    ['sens','SENS'], ['position','POSITION'], ['pk','PK'],
  ];
  const rows = FIELDS.map(([f, label]) => {
    const val = p[f]; if (!val && val !== 0) return '';
    const display = f === 'type_if'
      ? `<span class="pu-badge" style="background:${color};color:${badgeTextColor}">${val}</span>`
      : `<span class="pu-val">${val}</span>`;
    return `<div class="pu-row"><span class="pu-label">${label}</span>${display}</div>`;
  }).join('');

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

  let osmSection = '';
  if (anySupported) {
    const tagMap  = _buildOsmTags(feats);
    const osmRows = [...tagMap.entries()].map(([k,v]) => `
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

  // JOSM button disabled if no supported signals in group
  const josmDisabled = !anySupported ? ' disabled title="No supported signals at this location"' : '';

  const footer = `
    <div class="pu-footer">
      <button class="pu-action-btn" data-action="copy"
              ${!anySupported ? 'disabled title="No supported signals at this location"' : `title="${t('popup.copy')}"`}>
        <span class="icon icon-copy" aria-hidden="true"></span>
        ${t('popup.copy')}
      </button>
      <button class="pu-action-btn pu-josm-btn" data-action="josm"${josmDisabled}
              ${anySupported ? `title="${t('popup.josm')} (127.0.0.1:8111)"` : ''}>
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
                   style="vertical-align:-3px"></a>`;
  }
  if (status === 'not-in-osm') {
    return `<span class="pu-osm-indicator" title="${t('osm.notInOsm')}"
            ><img src="assets/svg/osm.svg" width="16" height="16" alt=""
                  style="vertical-align:-3px;filter:grayscale(1) opacity(.3)"></span>`;
  }
  if (status === 'error') {
    return `<button class="pu-osm-indicator osm-retry" data-action="osm-retry"
                    title="${t('osm.retry')}">↻</button>`;
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

  // Encode addtags: each "key=value" pair encoded as a unit, joined by encoded pipe
  const addtags = [...tagMap.entries()]
    .map(([k, v]) => encodeURIComponent(`${k}=${v}`))
    .join(encodeURIComponent('|'));

  const comment = encodeURIComponent(t('josm.comment'));

  // /open_changeset sets the default comment for the next upload dialog in JOSM
  const commentUrl = `http://127.0.0.1:8111/open_changeset?changeset_comment=${comment}&changeset_source=SNCF Open Data`;
  const addUrl     = `http://127.0.0.1:8111/add_node?lat=${latlng[0]}&lon=${latlng[1]}&addtags=${addtags}`;

  // fetch() to 127.0.0.1 works from HTTPS in Firefox and Chrome (mixed-content exception)
  const run = async () => {
    await fetch(commentUrl, { mode: 'no-cors' }).catch(() => {});
    await fetch(addUrl, { mode: 'no-cors' });
  };
  run()
    .then(() => _flash(btn, t('popup.josmSent'), '#4ade80', '#0b0e16'))
    .catch(err => { console.warn('[JOSM]', err.message); alert('JOSM not reachable: ' + err.message); });
}

function _flash(btn, label, bg, fg) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.innerHTML = `<span class="icon icon-check" aria-hidden="true"></span> ${label}`;
  btn.style.background = bg; btn.style.color = fg;
  setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2400);
}

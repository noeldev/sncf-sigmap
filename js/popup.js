/**
 * popup.js
 * Signal popup: displays properties and handles multi-signal
 * navigation when several signals share the same location.
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

// Fields to display and their labels
const POPUP_FIELDS = [
  ['type_if',    'TYPE IF'],
  ['code_ligne', 'CODE LIGNE'],
  ['nom_voie',   'NOM VOIE'],
  ['sens',       'SENS'],
  ['position',   'POSITION'],
  ['pk',         'PK'],
  ['code_voie',  'CODE VOIE'],
  ['idreseau',   'ID RÉSEAU'],
];

let _currentPopup = null;

/**
 * Opens a popup at the given latlng for an array of signal objects.
 * @param {L.LatLngExpression} latlng
 * @param {{ lng, lat, p }[]} feats  - array of signals at this location
 * @param {number} idx               - index of the signal to show first
 */
export function openSignalPopup(latlng, feats, idx = 0) {
  if (_currentPopup) { _currentPopup.remove(); _currentPopup = null; }

  const popup = L.popup({
    maxWidth:    320,
    autoPan:     true,
    className:   'signal-popup',
    closeButton: true,
  })
    .setLatLng(latlng)
    .setContent(_buildContent(feats, idx))
    .openOn(map);

  _currentPopup = popup;

  // Delegate navigation button clicks (re-render on nav)
  popup.getElement()?.addEventListener('click', e => {
    const btn = e.target.closest('[data-nav]');
    if (!btn) return;
    popup.setContent(_buildContent(feats, parseInt(btn.dataset.nav, 10)));
  });
}

function _buildContent(feats, idx) {
  const feat  = feats[idx];
  const p     = feat.p;
  const total = feats.length;
  const color = TYPE_COLORS[p.type_if] || '#94a3b8';

  const navBar = total > 1 ? `
    <div class="pu-nav">
      <span class="pu-nav-label">Signal ${idx + 1} / ${total}</span>
      <div class="pu-nav-btns">
        <button class="pu-nav-btn" data-nav="${idx - 1}" ${idx === 0 ? 'disabled' : ''}>&#8249;</button>
        <button class="pu-nav-btn" data-nav="${idx + 1}" ${idx === total - 1 ? 'disabled' : ''}>&#8250;</button>
      </div>
    </div>` : '';

  const rows = POPUP_FIELDS.map(([field, label]) => {
    const val = p[field];
    if (val === undefined || val === null || val === '') return '';
    const display = field === 'type_if'
      ? `<span class="pu-badge" style="background:${color}">${val}</span>`
      : `<span class="pu-val">${val}</span>`;
    return `<div class="pu-row"><span class="pu-label">${label}</span>${display}</div>`;
  }).join('');

  return `<div class="pu-wrap">${navBar}<div class="pu-body">${rows}</div></div>`;
}

export function getTypeColor(type) {
  return TYPE_COLORS[type] || '#94a3b8';
}

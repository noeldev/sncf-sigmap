/**
 * filters.js — Filter panel with combo-box dropdowns.
 *
 * Starts empty; the user adds filters via the "+ Add filter" button.
 * Available fields: type_if, code_ligne, nom_voie, sens, position.
 * The "Supported only" toggle is rendered inside the type_if filter group.
 */

import { SIGNAL_MAPPING } from './signal-mapping.js';
import { t, applyTranslations, onLangChange } from './i18n.js';

export const ALL_FILTER_FIELDS = [
  { key: 'type_if',    labelKey: 'field.type_if'    },
  { key: 'code_ligne', labelKey: 'field.code_ligne'  },
  { key: 'nom_voie',   labelKey: 'field.nom_voie'    },
  { key: 'sens',       labelKey: 'field.sens'        },
  { key: 'position',   labelKey: 'field.position'    },
];

export let activeFilters = {};

let _indexValues = {};
let _counts      = {};
let _defs        = [];   // starts empty; user adds via "+ Add filter"
let _mappedOnly  = false;
let _mappedTypes = new Set(Object.keys(SIGNAL_MAPPING));
let _onChange    = null;

ALL_FILTER_FIELDS.forEach(f => {
  _indexValues[f.key] = [];
  _counts[f.key]      = new Map();
});

export function refreshFilterLabels() {
  // Re-render all filter panel labels and dropdown placeholders after a language change
  _buildPanels();
}

export function initFilters(onChange) {
  _onChange = onChange;
  activeFilters = {};
  _buildPanels();

  document.addEventListener('click', e => {
    // Close filter dropdowns when clicking outside any fg-combo
    if (!e.target.closest('.fg-combo')) _closeAll();
    // Dismiss the add-filter menu when clicking outside it (and outside the button)
    if (!e.target.closest('.add-filter-menu') && !e.target.closest('#btn-add-filter'))
        document.querySelector('.add-filter-menu')?.remove();
  });

  // Rebuild panels when language changes so placeholders update
  onLangChange(() => _buildPanels());
}

export async function loadFilterIndex(tilesBase) {
  try {
    const res = await fetch(tilesBase + 'index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    ALL_FILTER_FIELDS.forEach(f => {
      if (data[f.key]) _indexValues[f.key] = data[f.key];
    });
    _defs.forEach((_, i) => _refreshDropdown(i));
  } catch (err) {
    console.warn('[Filters] index.json:', err.message);
  }
}

export function indexSignals(signals) {
  let changed = false;
  for (const s of signals) {
    ALL_FILTER_FIELDS.forEach(f => {
      const v = s.p[f.key];
      if (v) { _counts[f.key].set(v, (_counts[f.key].get(v) || 0) + 1); changed = true; }
    });
  }
  if (changed) _defs.forEach((_, i) => _refreshDropdown(i));
}

export function resetCounts() {
  ALL_FILTER_FIELDS.forEach(f => { _counts[f.key] = new Map(); });
}

export function resetFilters() {
  activeFilters = {};
  _mappedOnly   = false;
  _defs.forEach(d => { d.search = ''; });
  _buildPanels();
  _onChange?.();
}

export function getActiveFiltersForWorker() {
  const out = {};
  for (const [f, vals] of Object.entries(activeFilters)) {
    if (vals.size > 0) out[f] = [...vals];
  }
  return out;
}

export function initAddFilterButton(btn) {
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();

    // Toggle: if the menu is already open, just close it
    const existing = document.querySelector('.add-filter-menu');
    if (existing) { existing.remove(); return; }

    const used      = new Set(_defs.map(d => d.field));
    const available = ALL_FILTER_FIELDS.filter(f => !used.has(f.key));
    if (!available.length) return;

    const menu = document.createElement('div');
    menu.className = 'add-filter-menu';
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, {
      position: 'fixed',
      top:  (r.bottom + 4) + 'px',
      left: r.left + 'px',
      zIndex: '9999',
    });

    available.forEach(f => {
      const opt = document.createElement('div');
      opt.className   = 'afm-option';
      opt.textContent = t(f.labelKey);
      opt.addEventListener('mousedown', e2 => {
        e2.preventDefault();
        e2.stopPropagation();
        _defs.push({ field: f.key, search: '' });
        _buildPanels();
        menu.remove();
      });
      menu.appendChild(opt);
    });

    document.body.appendChild(menu);
  });
}

/* ===== Panel DOM ===== */

function _buildPanels() {
  const container = document.getElementById('filters-container');
  if (!container) return;
  container.innerHTML = '';

  _defs.forEach((def, idx) => {
    const isTypeIf = def.field === 'type_if';
    const label    = t(ALL_FILTER_FIELDS.find(f => f.key === def.field)?.labelKey || def.field);

    const panel = document.createElement('div');
    panel.className = 'filter-group';

    // Render the "Supported only" toggle inside the type_if filter group only
    const supportedHtml = isTypeIf ? `
      <div class="supported-only-row">
        <label class="supported-only-label">
          <input type="checkbox" id="chk-mapped-only" class="sr-only"${_mappedOnly ? ' checked' : ''}>
          <span class="toggle-track${_mappedOnly ? ' checked' : ''}">
            <span class="toggle-thumb"></span>
          </span>
          <span class="toggle-label" data-i18n="toggle.supported">${t('toggle.supported')}</span>
        </label>
      </div>` : '';

    panel.innerHTML = `
      <div class="fg-header">
        <span class="fg-title">${label}</span>
        <button class="fg-remove" title="${t('dropdown.remove')}">&#10005;</button>
      </div>
      <div class="fg-tags" id="fgt-${idx}"></div>
      <div class="fg-combo" id="fgc-${idx}">
        <div class="fg-combo-input" id="fgci-${idx}">
          <input id="fgi-${idx}" class="fg-search" type="text"
                 autocomplete="off" spellcheck="false"
                 placeholder="${t('dropdown.search', 0)}">
          <span class="fg-combo-arrow">&#9662;</span>
        </div>
        <div class="fg-dropdown is-hidden" id="fgd-${idx}">
          <div id="fgl-${idx}" class="fg-dropdown-inner"></div>
        </div>
      </div>
      ${supportedHtml}`;

    container.appendChild(panel);

    panel.querySelector('.fg-remove').addEventListener('click', () => {
      delete activeFilters[def.field];
      _defs.splice(idx, 1);
      _buildPanels();
      _onChange?.();
    });

    const input = document.getElementById(`fgi-${idx}`);
    input.addEventListener('input',   () => { def.search = input.value; _refreshDropdown(idx); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); _selectFirst(idx); }
      if (e.key === 'Escape') { _closeDropdown(idx); }
    });
    input.addEventListener('focus', () => _openDropdown(idx));

    document.getElementById(`fgci-${idx}`)
      .addEventListener('mousedown', e => {
        if (e.target === input) return;
        e.preventDefault();
          document.getElementById(`fgd-${idx}`).classList.contains('is-hidden')
          ? (_openDropdown(idx), input.focus())
          : _closeDropdown(idx);
      });

    if (isTypeIf) {
      const chk = panel.querySelector('#chk-mapped-only');
      if (chk) {
        chk.addEventListener('change', () => {
          _mappedOnly = chk.checked;
          _syncToggle(_mappedOnly);
          delete activeFilters['type_if'];
          _defs.forEach(d => { if (d.field === 'type_if') d.search = ''; });
          _buildPanels();
          _onChange?.();
        });
      }
    }

    _refreshTags(idx);
    _refreshDropdown(idx);
  });

  _updateStatusBar();
}

function _syncToggle(checked) {
  const track = document.querySelector('.toggle-track');
  if (track) track.classList.toggle('checked', checked);
}

/* ===== In-place DOM updates (avoid losing focus) ===== */

function _refreshTags(idx) {
  const def = _defs[idx];
  const el  = document.getElementById(`fgt-${idx}`);
  if (!el || !def) return;
  const sel = activeFilters[def.field] || new Set();
  el.innerHTML = '';
  for (const v of sel) {
    const tag = document.createElement('span');
    tag.className = 'fg-tag';
    tag.innerHTML = `${_esc(v)} <button class="fg-tag-remove">&#10005;</button>`;
    tag.querySelector('.fg-tag-remove')
      .addEventListener('mousedown', e => { e.preventDefault(); _toggle(def.field, v); });
    el.appendChild(tag);
  }
}

function _refreshDropdown(idx) {
  const def   = _defs[idx];
  const list  = document.getElementById(`fgl-${idx}`);
  const input = document.getElementById(`fgi-${idx}`);
  if (!list || !def) return;

  // _indexValues is pre-loaded from index.json; for fields not included there (nom_voie,
  // sens, position) fall back to the keys seen in the loaded tiles (_counts).
  const fromIndex  = _indexValues[def.field] || [];
  const fromCounts = [...(_counts[def.field]?.keys() || [])];
  let all = fromIndex.length > 0
    ? [...new Set([...fromIndex, ...fromCounts])]  // merge: index values + live counts
    : fromCounts;
  const sel = activeFilters[def.field] || new Set();
  const q   = (def.search || '').toLowerCase();

  const isTypeIf           = def.field === 'type_if';
  const isMappedOnlyActive = _mappedOnly && isTypeIf;
  if (isMappedOnlyActive) all = all.filter(v => _mappedTypes.has(v));

  if (input) input.placeholder = t('dropdown.search', all.length);

  // code_ligne values are numeric — sort by numeric value.
  // All other fields sort alphabetically (localeCompare handles mixed nom_voie well).
  const numericSort = def.field === 'code_ligne';
  const filtered = all
    .filter(v => v.toLowerCase().includes(q))
    .map(v => ({ v, count: _counts[def.field]?.get(v) || 0, mapped: _mappedTypes.has(v) }))
    .sort(numericSort
      ? (a, b) => (parseFloat(a.v) || 0) - (parseFloat(b.v) || 0) || a.v.localeCompare(b.v)
      : (a, b) => a.v.localeCompare(b.v));

  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = `<div class="fg-empty">${t('dropdown.noMatch')}</div>`;
    return;
  }

  filtered.forEach(({ v, count, mapped }) => {
    const active  = sel.has(v);
    // Supported-type dot indicator only makes sense for the type_if field;
    // isTypeIf is hoisted above the loop to avoid re-evaluating the field name each iteration.
    const showDot = isTypeIf && mapped && !isMappedOnlyActive;
    const item    = document.createElement('div');
    item.className     = `fg-drop-item${active ? ' active' : ''}${showDot ? ' mapped' : ''}`;
    item.dataset.field = def.field;
    item.dataset.val   = v;
    item.innerHTML     = `
      <span class="fgi-check${active ? ' checked' : ''}"></span>
      <span class="fgi-name">${_esc(v)}</span>
      <span class="fgi-count">${count > 0 ? count.toLocaleString() : ''}</span>`;
    item.addEventListener('mousedown', e => { e.preventDefault(); _toggle(def.field, v); });
    list.appendChild(item);
  });
}

function _selectFirst(idx) {
  const first = document.getElementById(`fgl-${idx}`)?.querySelector('.fg-drop-item');
  if (first) _toggle(first.dataset.field, first.dataset.val);
}

function _openDropdown(idx)  {
    const dd = document.getElementById(`fgd-${idx}`); if (dd) dd.classList.remove('is-hidden');
}
function _closeDropdown(idx) {
    const dd = document.getElementById(`fgd-${idx}`); if (dd) dd.classList.add('is-hidden');
}
function _closeAll() { _defs.forEach((_, i) => _closeDropdown(i)); }

function _toggle(field, val) {
  if (!activeFilters[field]) activeFilters[field] = new Set();
  activeFilters[field].has(val)
    ? activeFilters[field].delete(val)
    : activeFilters[field].add(val);
  if (activeFilters[field].size === 0) delete activeFilters[field];
  const idx = _defs.findIndex(d => d.field === field);
  if (idx >= 0) { _refreshTags(idx); _refreshDropdown(idx); _openDropdown(idx); }
  _updateStatusBar();
  _onChange?.();
}

function _updateStatusBar() {
  const el = document.getElementById('st-filters');
  if (el) el.textContent = Object.values(activeFilters).filter(s => s.size > 0).length;
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

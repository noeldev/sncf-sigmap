/**
 * filters.js — Filter panel with combo-box dropdowns.
 *
 * _buildPanels() creates DOM once. _refreshDropdown() / _refreshTags()
 * mutate existing elements — focus is never lost on keystroke.
 * mousedown on items calls e.preventDefault() to prevent input blur.
 */

import { SIGNAL_MAPPING } from './signal-mapping.js';

export const FILTER_FIELDS = [
  { key: 'type_if',    label: 'TYPE IF' },
  { key: 'code_ligne', label: 'CODE LIGNE' },
];

export let activeFilters = {};

let _indexValues = { type_if: [], code_ligne: [] };
let _counts      = { type_if: new Map(), code_ligne: new Map() };
let _defs        = [
  { field: 'type_if',    search: '' },
  { field: 'code_ligne', search: '' },
];
let _mappedOnly  = false;
let _mappedTypes = new Set(Object.keys(SIGNAL_MAPPING));
let _onChange    = null;

export function initFilters(onChange) {
  _onChange = onChange;
  activeFilters = {};
  _buildPanels();
  document.addEventListener('click', e => {
    if (!e.target.closest('.fg-combo')) _closeAll();
  });
  const chk = document.getElementById('chk-mapped-only');
  if (chk) {
    chk.addEventListener('change', () => {
      _mappedOnly = chk.checked;
      activeFilters = {};
      _defs.forEach(d => { d.search = ''; });
      _buildPanels();
      _onChange?.();
    });
  }
}

export async function loadFilterIndex(tilesBase) {
  try {
    const res  = await fetch(tilesBase + 'index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _indexValues.type_if    = data.type_if    || [];
    _indexValues.code_ligne = data.code_ligne || [];
    _defs.forEach((_, i) => _refreshDropdown(i));
  } catch (err) {
    console.warn('[Filters] index.json:', err.message);
  }
}

export function indexSignals(signals) {
  let changed = false;
  for (const s of signals) {
    for (const f of ['type_if', 'code_ligne']) {
      const v = s.p[f];
      if (v) { _counts[f].set(v, (_counts[f].get(v) || 0) + 1); changed = true; }
    }
  }
  if (changed) _defs.forEach((_, i) => _refreshDropdown(i));
}

export function resetCounts() {
  _counts = { type_if: new Map(), code_ligne: new Map() };
}

export function resetFilters() {
  activeFilters = {};
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
    const used      = _defs.map(d => d.field);
    const available = FILTER_FIELDS.filter(f => !used.includes(f.key));
    if (!available.length) return;

    document.querySelectorAll('.add-filter-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'add-filter-menu';
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, { top: r.bottom + 4 + 'px', left: r.left + 'px' });

    available.forEach(f => {
      const opt = document.createElement('div');
      opt.className   = 'afm-option';
      opt.textContent = f.label;
      opt.addEventListener('mousedown', e2 => {
        e2.preventDefault();
        _defs.push({ field: f.key, search: '' });
        _buildPanels();
        menu.remove();
      });
      menu.appendChild(opt);
    });
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
  });
}

// ---------------------------------------------------------------------------
// Panel construction (once per reset or structural change)
// ---------------------------------------------------------------------------

function _buildPanels() {
  const container = document.getElementById('filters-container');
  if (!container) return;
  container.innerHTML = '';

  _defs.forEach((def, idx) => {
    const panel = document.createElement('div');
    panel.className = 'filter-group';
    panel.innerHTML = `
      <div class="fg-header">
        <span class="fg-title">${_label(def.field)}</span>
        <button class="fg-remove" title="Remove filter">&#10005;</button>
      </div>
      <div class="fg-tags" id="fgt-${idx}"></div>
      <div class="fg-combo" id="fgc-${idx}">
        <div class="fg-combo-input" id="fgci-${idx}">
          <input id="fgi-${idx}" class="fg-search" type="text"
                 autocomplete="off" spellcheck="false" placeholder="Search…">
          <span class="fg-combo-arrow">&#9662;</span>
        </div>
        <div class="fg-dropdown" id="fgd-${idx}" style="display:none">
          <div id="fgl-${idx}" class="fg-dropdown-inner"></div>
        </div>
      </div>`;
    container.appendChild(panel);

    panel.querySelector('.fg-remove').addEventListener('click', () => {
      delete activeFilters[def.field];
      _defs.splice(idx, 1);
      _buildPanels();
      _onChange?.();
    });

    const input = document.getElementById(`fgi-${idx}`);
    input.addEventListener('input', () => { def.search = input.value; _refreshDropdown(idx); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); _selectFirst(idx); }
      if (e.key === 'Escape') { _closeDropdown(idx); }
    });
    input.addEventListener('focus', () => _openDropdown(idx));

    document.getElementById(`fgci-${idx}`).addEventListener('mousedown', e => {
      if (e.target === input) return;
      e.preventDefault();
      document.getElementById(`fgd-${idx}`).style.display === 'none'
        ? (_openDropdown(idx), input.focus())
        : _closeDropdown(idx);
    });

    _refreshTags(idx);
    _refreshDropdown(idx);
  });

  _updateStatusBar();
}

// ---------------------------------------------------------------------------
// In-place DOM updates (no rebuild, no focus loss)
// ---------------------------------------------------------------------------

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
    tag.querySelector('.fg-tag-remove').addEventListener('mousedown', e => {
      e.preventDefault(); _toggle(def.field, v);
    });
    el.appendChild(tag);
  }
}

function _refreshDropdown(idx) {
  const def   = _defs[idx];
  const list  = document.getElementById(`fgl-${idx}`);
  const input = document.getElementById(`fgi-${idx}`);
  if (!list || !def) return;

  let all      = _indexValues[def.field] || [];
  const counts = _counts[def.field] || new Map();
  const sel    = activeFilters[def.field] || new Set();
  const q      = (def.search || '').toLowerCase();

  // When "mapped only" is active for type_if, filter the list
  // AND suppress the mapped-indicator dot (it's implicit, all items are mapped)
  const isMappedOnlyActive = _mappedOnly && def.field === 'type_if';
  if (isMappedOnlyActive) all = all.filter(v => _mappedTypes.has(v));

  if (input) input.placeholder = `Search ${all.length} values…`;

  const filtered = all
    .filter(v => v.toLowerCase().includes(q))
    .map(v => ({ v, count: counts.get(v) || 0, mapped: _mappedTypes.has(v) }))
    .sort((a, b) => b.count - a.count || a.v.localeCompare(b.v));

  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = `<div class="fg-empty">No matching values</div>`;
    return;
  }

  filtered.forEach(({ v, count, mapped }) => {
    const active = sel.has(v);
    const item   = document.createElement('div');
    // Show mapped dot only when "mapped only" checkbox is NOT active
    const showDot = mapped && !isMappedOnlyActive;
    item.className     = `fg-drop-item${active ? ' active' : ''}${showDot ? ' mapped' : ''}`;
    item.dataset.field = def.field;
    item.dataset.val   = v;
    item.innerHTML     = `
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

function _openDropdown(idx) {
  const dd = document.getElementById(`fgd-${idx}`);
  if (dd) dd.style.display = 'block';
}
function _closeDropdown(idx) {
  const dd = document.getElementById(`fgd-${idx}`);
  if (dd) dd.style.display = 'none';
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

function _label(key) {
  return (FILTER_FIELDS.find(f => f.key === key) || { label: key.toUpperCase() }).label;
}
function _esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

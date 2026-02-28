/**
 * filters.js
 * Filter panel — searchable combo-box dropdowns.
 * The dropdown list is updated in-place so the search input never loses focus.
 * Values pre-loaded from index.json; counts update as tiles load.
 */

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
let _onChange = null;

// ── Public API ────────────────────────────────────────────────────────────

export function initFilters(onChange) {
  _onChange = onChange;
  activeFilters = {};
  _buildPanels();
  document.addEventListener('click', e => {
    if (!e.target.closest('.fg-combo')) _closeAll();
  });
}

export async function loadFilterIndex(tilesBase) {
  try {
    const res  = await fetch(tilesBase + 'index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _indexValues.type_if    = data.type_if    || [];
    _indexValues.code_ligne = data.code_ligne || [];
    _defs.forEach((_, i) => _refreshDropdown(i));
    _defs.forEach((_, i) => _refreshTags(i));
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
  _defs.forEach((_, i) => _refreshDropdown(i));
}

export function resetFilters() {
  activeFilters = {};
  _defs.forEach(d => { d.search = ''; });
  _closeAll();
  _buildPanels();
  _onChange && _onChange();
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
    menu.style.cssText = `top:${r.bottom+4}px;left:${r.left}px`;
    available.forEach(f => {
      const opt       = document.createElement('div');
      opt.className   = 'afm-option';
      opt.textContent = f.label;
      opt.addEventListener('click', () => {
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

// ── Full panel build (init / explicit reset only) ─────────────────────────

function _buildPanels() {
  const container = document.getElementById('filters-container');
  if (!container) return;
  container.innerHTML = '';

  _defs.forEach((def, idx) => {
    const panel      = document.createElement('div');
    panel.className  = 'filter-group';
    panel.id         = `fg-panel-${idx}`;
    panel.innerHTML  = `
      <div class="fg-header">
        <span class="fg-title">${_label(def.field)}</span>
        <button class="fg-remove" data-idx="${idx}" title="Remove filter">✕</button>
      </div>
      <div class="fg-tags"  id="fg-tags-${idx}"></div>
      <div class="fg-combo" id="fg-combo-${idx}">
        <div class="fg-combo-input" id="fg-input-${idx}">
          <input id="fg-search-${idx}" class="fg-search" type="text"
                 autocomplete="off" spellcheck="false"
                 placeholder="Search ${(_indexValues[def.field]||[]).length} values…"
                 value="${_esc(def.search)}">
          <span class="fg-combo-arrow">▾</span>
        </div>
        <div class="fg-dropdown" id="fg-dd-${idx}" style="display:none">
          <div class="fg-dropdown-inner" id="fg-list-${idx}"></div>
        </div>
      </div>`;
    container.appendChild(panel);

    panel.querySelector('.fg-remove').addEventListener('click', () => {
      delete activeFilters[def.field];
      _defs.splice(idx, 1);
      _buildPanels();
      _onChange && _onChange();
    });

    const input = document.getElementById(`fg-search-${idx}`);

    // Key events — update list in-place, never rebuild panels
    input.addEventListener('input', () => {
      def.search = input.value;
      _refreshDropdown(idx);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); _selectFirst(idx); }
      if (e.key === 'Escape') { _closeDropdown(idx); input.blur(); }
    });
    input.addEventListener('focus', () => _openDropdown(idx));
    input.addEventListener('click', e => { e.stopPropagation(); _openDropdown(idx); });

    // Arrow / combo wrapper
    document.getElementById(`fg-combo-${idx}`).addEventListener('click', e => {
      e.stopPropagation();
      const dd = document.getElementById(`fg-dd-${idx}`);
      if (dd.style.display === 'none') { _openDropdown(idx); input.focus(); }
      else                              { _closeDropdown(idx); }
    });

    _refreshTags(idx);
    _refreshDropdown(idx);
  });

  _updateStatusBar();
}

// ── In-place refreshes ────────────────────────────────────────────────────

function _refreshTags(idx) {
  const def = _defs[idx];
  const el  = document.getElementById(`fg-tags-${idx}`);
  if (!el || !def) return;
  const sel = activeFilters[def.field] || new Set();
  el.innerHTML = [...sel].map(v => `
    <span class="fg-tag">${_esc(v)}
      <button class="fg-tag-remove" data-field="${def.field}" data-val="${_esc(v)}">✕</button>
    </span>`).join('');
  el.querySelectorAll('.fg-tag-remove').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); _toggle(b.dataset.field, b.dataset.val); })
  );
}

function _refreshDropdown(idx) {
  const def   = _defs[idx];
  const list  = document.getElementById(`fg-list-${idx}`);
  const input = document.getElementById(`fg-search-${idx}`);
  if (!list || !def) return;

  const all    = _indexValues[def.field] || [];
  const counts = _counts[def.field]      || new Map();
  const sel    = activeFilters[def.field] || new Set();
  const q      = def.search.toLowerCase();

  if (input) input.placeholder = `Search ${all.length} values…`;

  const filtered = all
    .filter(v => v.toLowerCase().includes(q))
    .map(v    => ({ v, count: counts.get(v) || 0 }))
    .sort((a, b) => b.count - a.count || a.v.localeCompare(b.v));

  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = '<div class="fg-empty">No matching values</div>';
    return;
  }
  filtered.forEach(({ v, count }) => {
    const active = sel.has(v);
    const item   = document.createElement('div');
    item.className     = 'fg-drop-item' + (active ? ' active' : '');
    item.dataset.field = def.field;
    item.dataset.val   = v;
    item.innerHTML     = `
      <span class="fgi-check">${active ? '✓' : ''}</span>
      <span class="fgi-name">${_esc(v)}</span>
      <span class="fgi-count">${count > 0 ? count.toLocaleString() : ''}</span>`;
    // mousedown prevents blur on the search input before the click fires
    item.addEventListener('mousedown', e => { e.preventDefault(); _toggle(def.field, v); });
    list.appendChild(item);
  });
}

function _selectFirst(idx) {
  const first = document.getElementById(`fg-list-${idx}`)?.querySelector('.fg-drop-item');
  if (first) _toggle(first.dataset.field, first.dataset.val);
}

// ── Open / close ──────────────────────────────────────────────────────────

function _openDropdown(idx) {
  const dd = document.getElementById(`fg-dd-${idx}`);
  if (dd) dd.style.display = 'block';
}
function _closeDropdown(idx) {
  const dd = document.getElementById(`fg-dd-${idx}`);
  if (dd) dd.style.display = 'none';
}
function _closeAll() { _defs.forEach((_, i) => _closeDropdown(i)); }

// ── Filter toggle ─────────────────────────────────────────────────────────

function _toggle(field, val) {
  if (!activeFilters[field]) activeFilters[field] = new Set();
  activeFilters[field].has(val)
    ? activeFilters[field].delete(val)
    : activeFilters[field].add(val);
  if (activeFilters[field].size === 0) delete activeFilters[field];
  const idx = _defs.findIndex(d => d.field === field);
  if (idx >= 0) { _refreshTags(idx); _refreshDropdown(idx); _openDropdown(idx); }
  _updateStatusBar();
  _onChange && _onChange();
}

function _updateStatusBar() {
  const el = document.getElementById('st-filters');
  if (el) el.textContent = Object.values(activeFilters).filter(s => s.size > 0).length;
}

function _label(key) {
  return (FILTER_FIELDS.find(f => f.key === key) || { label: key.toUpperCase() }).label;
}
function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

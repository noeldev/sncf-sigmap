/**
 * filters.js
 * Filter panel: TYPE IF and CODE LIGNE.
 * Values are pre-populated from index.json at startup,
 * then counts are updated progressively as tiles load.
 */

export const FILTER_FIELDS = [
  { key: 'type_if',    label: 'TYPE IF' },
  { key: 'code_ligne', label: 'CODE LIGNE' },
];

// Active filters: { fieldKey: Set<string> }
export let activeFilters = {};

// All known values from index.json: { fieldKey: string[] }
let _indexValues = { type_if: [], code_ligne: [] };

// Signal counts accumulated from loaded tiles: { fieldKey: Map<value, count> }
let _counts = { type_if: new Map(), code_ligne: new Map() };

// Active filter panel definitions: [{ field, searchText }]
let _filterDefs = [
  { field: 'type_if',    searchText: '' },
  { field: 'code_ligne', searchText: '' },
];

let _onChange = null;

// ---- Public API ----

export function initFilters(onChange) {
  _onChange = onChange;
  activeFilters = {};
  _render();
}

/** Load index.json and pre-populate filter value lists. */
export async function loadFilterIndex(tilesBase) {
  try {
    const res = await fetch(tilesBase + 'index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _indexValues.type_if    = data.type_if    || [];
    _indexValues.code_ligne = data.code_ligne || [];
    _render();
  } catch (err) {
    console.warn('[Filters] Could not load index.json:', err.message);
  }
}

/** Accumulate signal counts from a freshly loaded tile batch. */
export function indexSignals(signals) {
  for (const s of signals) {
    for (const field of ['type_if', 'code_ligne']) {
      const v = s.p[field];
      if (v) _counts[field].set(v, (_counts[field].get(v) || 0) + 1);
    }
  }
  _render();
}

/** Clear counts when the viewport changes significantly. */
export function resetCounts() {
  _counts = { type_if: new Map(), code_ligne: new Map() };
}

export function resetFilters() {
  activeFilters = {};
  _filterDefs.forEach(f => { f.searchText = ''; });
  _render();
  _onChange && _onChange();
}

export function getActiveFiltersForWorker() {
  const out = {};
  for (const [field, vals] of Object.entries(activeFilters)) {
    if (vals.size > 0) out[field] = [...vals];
  }
  return out;
}

// ---- Rendering ----

function _render() {
  const container = document.getElementById('filters-container');
  if (!container) return;
  container.innerHTML = '';

  _filterDefs.forEach((fd, idx) => {
    // Use index values (full list) with counts from loaded tiles where available
    const allValues = _indexValues[fd.field] || [];
    const counts    = _counts[fd.field] || new Map();

    const filtered = allValues
      .filter(v => v.toLowerCase().includes(fd.searchText.toLowerCase()))
      .map(v => ({ v, count: counts.get(v) || 0 }))
      .sort((a, b) => b.count - a.count || a.v.localeCompare(b.v));

    const group = document.createElement('div');
    group.className = 'filter-group';
    group.innerHTML = `
      <div class="fg-header">
        <span class="fg-title">${_label(fd.field)}</span>
        <button class="fg-remove" title="Remove filter" data-idx="${idx}">✕</button>
      </div>
      <input class="fg-search" placeholder="Search… (${allValues.length} values)" value="${_esc(fd.searchText)}" data-idx="${idx}">
      <div class="fg-values" id="fg-${idx}"></div>
    `;
    container.appendChild(group);

    const fvEl = group.querySelector(`#fg-${idx}`);

    if (filtered.length === 0) {
      fvEl.innerHTML = '<div class="fg-empty">No values loaded yet</div>';
    } else {
      filtered.forEach(({ v, count }) => {
        const active = activeFilters[fd.field]?.has(v);
        const item   = document.createElement('div');
        item.className = 'fg-item' + (active ? ' active' : '');
        item.dataset.field = fd.field;
        item.dataset.val   = v;
        item.innerHTML = `
          <div class="fgi-check">${active ? '✓' : ''}</div>
          <div class="fgi-name">${_esc(v)}</div>
          <div class="fgi-count">${count > 0 ? count.toLocaleString() : ''}</div>
        `;
        fvEl.appendChild(item);
      });
    }
  });

  // Bind events
  container.querySelectorAll('.fg-remove').forEach(btn =>
    btn.addEventListener('click', () => _removeFilter(parseInt(btn.dataset.idx)))
  );
  container.querySelectorAll('.fg-search').forEach(input =>
    input.addEventListener('input', () => {
      _filterDefs[parseInt(input.dataset.idx)].searchText = input.value;
      _render();
    })
  );
  container.querySelectorAll('.fg-item').forEach(item =>
    item.addEventListener('click', () => _toggle(item.dataset.field, item.dataset.val))
  );

  // Update active filter count in status bar
  const active = Object.values(activeFilters).filter(s => s.size > 0).length;
  const el = document.getElementById('st-filters');
  if (el) el.textContent = active;
}

function _toggle(field, val) {
  if (!activeFilters[field]) activeFilters[field] = new Set();
  activeFilters[field].has(val)
    ? activeFilters[field].delete(val)
    : activeFilters[field].add(val);
  if (activeFilters[field].size === 0) delete activeFilters[field];
  _render();
  _onChange && _onChange();
}

function _removeFilter(idx) {
  delete activeFilters[_filterDefs[idx].field];
  _filterDefs.splice(idx, 1);
  _render();
  _onChange && _onChange();
}

function _label(key) {
  return (FILTER_FIELDS.find(f => f.key === key) || { label: key.toUpperCase() }).label;
}

function _esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function initAddFilterButton(btn) {
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const used      = _filterDefs.map(f => f.field);
    const available = FILTER_FIELDS.filter(f => !used.includes(f.key));
    if (!available.length) return;

    document.querySelectorAll('.add-filter-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'add-filter-menu';
    const rect = btn.getBoundingClientRect();
    menu.style.cssText = `top:${rect.bottom+4}px;left:${rect.left}px`;

    available.forEach(f => {
      const opt = document.createElement('div');
      opt.className   = 'afm-option';
      opt.textContent = f.label;
      opt.addEventListener('click', () => {
        _filterDefs.push({ field: f.key, searchText: '' });
        _render();
        menu.remove();
      });
      menu.appendChild(opt);
    });

    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
  });
}

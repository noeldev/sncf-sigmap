/**
 * filters.js
 * Filter panel: per-field faceted filters with counts, search, add/remove.
 */

export const AVAILABLE_FIELDS = [
  { key: 'type_if',    label: 'TYPE IF' },
  { key: 'code_ligne', label: 'CODE LIGNE' },
  { key: 'nom_voie',   label: 'NOM VOIE' },
  { key: 'sens',       label: 'SENS' },
  { key: 'position',   label: 'POSITION' },
];

// Active filter state: { fieldKey: Set<string> }
export let activeFilters = {};

// Filter panel config: [{ field, searchText }]
let filterDefs = [];

// Callback: invoked whenever filters change
let _onChange = null;

// All signals (lightweight array)
let _allSignals = [];

export function initFilters(allSignals, onChange) {
  _allSignals = allSignals;
  _onChange   = onChange;
  activeFilters = {};
  filterDefs = [
    { field: 'type_if',    searchText: '' },
    { field: 'code_ligne', searchText: '' },
  ];
  _render();
}

export function resetFilters() {
  activeFilters = {};
  filterDefs.forEach(f => { f.searchText = ''; });
  _render();
  _onChange && _onChange();
}

export function matchesFilters(signal) {
  for (const [field, vals] of Object.entries(activeFilters)) {
    if (vals.size === 0) continue;
    const v = String(signal.p[field] ?? '');
    if (!vals.has(v)) return false;
  }
  return true;
}

// ---- Rendering ----

function _render() {
  const container = document.getElementById('filters-container');
  if (!container) return;
  container.innerHTML = '';

  filterDefs.forEach((fd, idx) => {
    const valueCounts = _countValues(fd.field);
    const sorted = Object.entries(valueCounts)
      .sort((a, b) => b[1] - a[1])
      .filter(([v]) => v.toLowerCase().includes(fd.searchText.toLowerCase()));

    const group = document.createElement('div');
    group.className = 'filter-group';
    group.innerHTML = `
      <div class="fg-header">
        <span class="fg-title">${_label(fd.field)}</span>
        <button class="fg-remove" title="Remove filter" data-idx="${idx}">✕</button>
      </div>
      <input class="fg-search" placeholder="Search…" value="${_esc(fd.searchText)}" data-idx="${idx}">
      <div class="fg-values" id="fg-values-${idx}"></div>
    `;
    container.appendChild(group);

    const fvEl = group.querySelector(`#fg-values-${idx}`);
    sorted.forEach(([val, cnt]) => {
      const active = activeFilters[fd.field]?.has(val);
      const item   = document.createElement('div');
      item.className = 'fg-item' + (active ? ' active' : '');
      item.dataset.field = fd.field;
      item.dataset.val   = val;
      item.innerHTML = `
        <div class="fgi-check">${active ? '✓' : ''}</div>
        <div class="fgi-name">${_esc(val) || '<em>(empty)</em>'}</div>
        <div class="fgi-count">${cnt.toLocaleString('en')}</div>
      `;
      fvEl.appendChild(item);
    });
  });

  // Bind events
  container.querySelectorAll('.fg-remove').forEach(btn => {
    btn.addEventListener('click', () => _removeFilter(parseInt(btn.dataset.idx)));
  });
  container.querySelectorAll('.fg-search').forEach(input => {
    input.addEventListener('input', () => {
      filterDefs[parseInt(input.dataset.idx)].searchText = input.value;
      _render();
    });
  });
  container.querySelectorAll('.fg-item').forEach(item => {
    item.addEventListener('click', () => _toggleValue(item.dataset.field, item.dataset.val));
  });

  // Update active filter count in status bar
  const active = Object.values(activeFilters).filter(s => s.size > 0).length;
  const el = document.getElementById('st-filters');
  if (el) el.textContent = active;
}

function _countValues(field) {
  const counts = {};
  _allSignals.forEach(s => {
    const v = String(s.p[field] ?? '');
    counts[v] = (counts[v] || 0) + 1;
  });
  return counts;
}

function _toggleValue(field, val) {
  if (!activeFilters[field]) activeFilters[field] = new Set();
  if (activeFilters[field].has(val)) activeFilters[field].delete(val);
  else activeFilters[field].add(val);
  if (activeFilters[field].size === 0) delete activeFilters[field];
  _render();
  _onChange && _onChange();
}

function _removeFilter(idx) {
  const field = filterDefs[idx].field;
  delete activeFilters[field];
  filterDefs.splice(idx, 1);
  _render();
  _onChange && _onChange();
}

function _label(key) {
  return (AVAILABLE_FIELDS.find(f => f.key === key) || { label: key.toUpperCase() }).label;
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Add-filter dropdown ----
export function initAddFilterButton(btn) {
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const used      = filterDefs.map(f => f.field);
    const available = AVAILABLE_FIELDS.filter(f => !used.includes(f.key));
    if (available.length === 0) return;

    // Remove any existing menu
    document.querySelectorAll('.add-filter-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'add-filter-menu';
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';

    available.forEach(f => {
      const opt = document.createElement('div');
      opt.className   = 'afm-option';
      opt.textContent = f.label;
      opt.addEventListener('click', () => {
        filterDefs.push({ field: f.key, searchText: '' });
        _render();
        menu.remove();
      });
      menu.appendChild(opt);
    });

    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true });
    }, 10);
  });
}

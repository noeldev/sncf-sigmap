// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * report-renderer.js - DOM rendering for all validation report sections.
 *
 * Pure presentation layer: no analysis logic, no HTML strings.
 * All structure comes from <template> elements in validate.html.
 * All visible strings come from t() (validate.en-us.json).
 *
 * Responsibilities:
 *   - Stat cards                          (renderStats)
 *   - Conflict table + filter dropdown    (renderConflicts)
 *   - Unmapped types table                (renderUnmapped)
 *   - Spec diff sections                  (renderSpecDiff)
 *   - Preset vs wiki sync table           (renderPresetDiff)
 *   - Lazy Google Maps hrefs
 *   - Group-colored chip left borders      (group-mapping.js)
 *
 * Filter dropdown:
 *   Cloned from tpl-filter-btn-wrap (validate.html).
 *   One item per dupCat with colored dot, plus "All" row.
 *   Items cloned from tpl-filter-cat-item / tpl-filter-all-item.
 *   Filter state encoded in the URL hash.
 *
 * Visibility:
 *   Sections start with HTML `hidden`. _show() removes it + adds .visible.
 *   clearResults() restores both.
 */

import { getMappingEntry, getGroupForCat } from '../signal-types.js';
import { getColorForGroup, getUnsupportedGroup } from '../group-mapping.js';
import { getTypePriority } from '../signal-grouping.js';
import { initCollapsiblePanelsInRoot } from '../collapsible-panel.js';
import { t, translateElement } from '../translation.js';
import { makeSignalCatKey } from '../osm-tags.js';
import { contrastColor } from '../signal-mapping.js';
import {
    initConflictFilter, resetConflictFilter,
    toggleCat, toggleMechanical,
    isCatExcluded, isMechanicalShown, isFilterActive,
} from './conflict-filter.js';

// ===== Module-level constants =====

// Base URL of the app — strips the filename so it works on any path (localhost or production).
// Exported for use by validate-main.js in GeoJSON metadata.
export const APP_URL = window.location.origin
    + window.location.pathname.replace(/\/[^/]*$/, '');

// ===== Init =====

function _init() {
    const panels = document.getElementById('main');
    initCollapsiblePanelsInRoot(panels);

    _bindEvents();
}

function _bindEvents() {
    const btn = document.getElementById('btn-toc');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'instant' });
    });
}

_init();

// ===== Filter state =====
// Managed by conflict-filter.js — see that module for state and hash logic.
let _conflictCatCounts = new Map(); // Map<osmCat, number> — for dropdown rebuild

// Color for a chip: derived from the mapping's group key.
function _catColorFromMapping(mapping) {
    return getColorForGroup(mapping?.group ?? getUnsupportedGroup());
}

// ===== Template references (lazily initialised) =====

let _tplFilterBtnWrap = null;
let _tplFilterCatItem = null;
let _tplFilterAllItem = null;

function _getFilterTemplates() {
    if (!_tplFilterBtnWrap) {
        // Cache the <template> elements, not their .content DocumentFragments.
        // Cloning a cached fragment moves its children out on the first call,
        // leaving it empty for subsequent calls. Calling .content.cloneNode(true)
        // each time ensures the fragment is always read fresh from the element.
        _tplFilterBtnWrap = document.getElementById('tpl-filter-btn-wrap');
        _tplFilterCatItem = document.getElementById('tpl-filter-cat-item');
        _tplFilterAllItem = document.getElementById('tpl-filter-all-item');
    }
}

// ===== Public API =====

export function renderStats(stats) {
    _setText('stat-signals', stats.signals.toLocaleString());
    _setText('stat-locations', stats.locations.toLocaleString());
    _setText('stat-conflicts', stats.conflictLocations.toLocaleString());
    _setText('stat-unmapped', stats.unmappedTypes.toLocaleString());

    // Wiki diff = code<->wiki discrepancies; undefined when the wiki failed.
    if (stats.wikiDiff !== undefined) {
        _setText('stat-wiki-diff', stats.wikiDiff.toLocaleString());
    }
    // stat-preset-diff is filled by renderPresetDiff (async preset check).

    _show('stats-grid');
    _showNavLinks();
}

export function renderConflicts(conflicts) {
    const badge = _el('badge-conflicts');
    const content = _el('conflicts-content');
    badge.textContent = conflicts.length;
    _show('section-conflicts');

    if (conflicts.length === 0) {
        badge.className = 'badge badge-blue';
        content.replaceChildren(_noResults(t('message.noConflicts')));
        return;
    }

    badge.className = 'badge badge-red';

    const rows = [];
    for (const loc of conflicts) {
        for (const conflict of loc.conflicts) {
            rows.push({ loc, conflict, rowNum: rows.length + 1 });
        }
    }

    const catCounts = new Map();
    for (const { conflict } of rows) {
        for (const cat of conflict.dupCats) {
            catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
        }
    }

    const table = _cloneEl('tpl-table');
    table.className += ' table-conflicts';
    table.appendChild(_buildConflictThead(catCounts));

    const tbody = _cloneEl('tpl-tbody');
    for (const { loc, conflict, rowNum } of rows) {
        const tr = _buildConflictRow(loc, conflict, rowNum);
        tr.dataset.dupCats = conflict.dupCats.join(',');
        tr.dataset.isMech = conflict.isMech ? '1' : '0';
        tr.id = `conflict-${rowNum}`;
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    content.replaceChildren(table);
    _conflictCatCounts = catCounts;

    _registerGoogleMapsDelegate(content);
    initConflictFilter(tbody);
}

export function renderUnmapped(unmappedTypes) {
    const badge = _el('badge-unmapped');
    const content = _el('unmapped-content');
    badge.textContent = unmappedTypes.size;
    _show('section-unmapped');

    if (unmappedTypes.size === 0) {
        badge.className = 'badge badge-blue';
        content.replaceChildren(_noResults(t('message.allMapped')));
        return;
    }

    badge.className = 'badge badge-amber';
    const table = _cloneEl('tpl-table');

    const thead = _cloneAndTranslate('tpl-thead-unmapped');
    table.appendChild(thead);

    const tbody = _cloneEl('tpl-tbody');
    [...unmappedTypes.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([type, info], i) => {
            const row = _cloneEl('tpl-unmapped-row');
            const ids = [...info.networkIds].slice(0, 5);
            _fill(row, 'row-num', i + 1);
            _fill(row, 'type', type || '(empty)');
            _fill(row, 'count', info.count.toLocaleString());
            _fill(row, 'ids', ids.join(', '));
            _fill(row, 'overflow', info.networkIds.size > ids.length
                ? ` +${info.networkIds.size - ids.length} more` : '');
            tbody.appendChild(row);
        });

    table.appendChild(tbody);
    content.replaceChildren(table);
}

export function renderSpecDiff({ matched, onlyInWiki, onlyInCode }) {
    _show('section-spec');

    // Unmatched entries: only-in-wiki + only-in-code merged into one table,
    // with case-insensitive same-key values collapsed onto a shared row.
    // Code cats are normalised to OSM keys via makeSignalCatKey.
    const rows = _buildUnmatchedRows(onlyInWiki, onlyInCode, makeSignalCatKey);
    const { aSet, bSet } = _typeColumnSets(rows);

    _renderSpecTable({
        contentId: 'unmatched-content',
        badgeId: 'badge-unmatched',
        items: rows,
        emptyMsg: t('message.allMatch'),
        theadId: 'tpl-thead-spec-unmatched',
        rowId: 'tpl-spec-row-unmatched',
        emptyBadge: 'badge-blue',
        filledBadge: 'badge-amber',
        fillRow(row, { key, a, b }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', key);
            // Amber when both columns are present on this row, or the value also
            // appears somewhere in the opposite column (likely cross-key link).
            _setSpecCell(row.querySelector('[data-field="type-wiki"]'),
                a, !!a && (!!b || bSet.has(a)), !a);
            _setSpecCell(row.querySelector('[data-field="type-code"]'),
                b, !!b && (!!a || aSet.has(b)), !b);
        },
    });

    _renderSpecTable({
        contentId: 'matched-content',
        badgeId: 'badge-matched',
        items: [...matched].sort((a, b) =>
            makeSignalCatKey(a.cat).localeCompare(makeSignalCatKey(b.cat))
        ),
        emptyMsg: t('message.noMatches'),
        theadId: 'tpl-thead-spec-matched',
        rowId: 'tpl-spec-row-matched',
        emptyBadge: 'badge-blue',
        filledBadge: 'badge-blue',
        fillRow(row, { cat, type }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', makeSignalCatKey(cat));
            _fill(row, 'type', type);
        },
    });
}

/**
 * Reveal a result section by id without populating it. Used to surface the
 * preset section (and its status line) even when the preset fails to load.
 */
export function revealSection(id) {
    _show(id);
}

/**
 * Render the JOSM preset vs wiki synchronisation table.
 *
 * Wiki is the reference. Each row is a discrepancy with the wiki value and the
 * preset value side by side; a dash means the pair is absent from that source:
 *   wiki value + dash  -> documented in the wiki, missing from the presets.
 *   dash + preset value -> defined in the presets, undocumented in the wiki.
 * Same merge/highlight semantics as the spec cross-check, so a case-only
 * mismatch (FR:Chevron vs FR:chevron) collapses onto one highlighted row.
 *
 * @param {{ matched: object[], onlyInWiki: object[], onlyInPreset: object[] }} diff
 */
export function renderPresetDiff({ onlyInWiki, onlyInPreset }) {
    _show('section-preset');
    _setText('stat-preset-diff', (onlyInWiki.length + onlyInPreset.length).toLocaleString());

    // Preset cats already are OSM keys (no code normalisation): identity keyFn.
    const rows = _buildUnmatchedRows(onlyInWiki, onlyInPreset, cat => cat);
    const { aSet, bSet } = _typeColumnSets(rows);

    _renderSpecTable({
        contentId: 'preset-content',
        badgeId: 'badge-preset',
        items: rows,
        emptyMsg: t('message.presetInSync'),
        theadId: 'tpl-thead-preset',
        rowId: 'tpl-preset-row',
        emptyBadge: 'badge-blue',
        filledBadge: 'badge-amber',
        fillRow(row, { key, a, b }, i) {
            _fill(row, 'row-num', i + 1);
            _fill(row, 'key', key);
            _setSpecCell(row.querySelector('[data-field="type-wiki"]'),
                a, !!a && (!!b || bSet.has(a)), !a);
            _setSpecCell(row.querySelector('[data-field="type-preset"]'),
                b, !!b && (!!a || aSet.has(b)), !b);
        },
    });
}


export function clearResults() {
    const sectionIds = ['stats-grid',
        'section-conflicts', 'section-unmapped', 'section-spec', 'section-preset'];

    for (const id of sectionIds) {
        const el = _el(id);
        if (!el) continue;
        el.hidden = true;
        el.classList.remove('visible');
    }

    ['stat-signals', 'stat-locations', 'stat-conflicts', 'stat-unmapped',
        'stat-wiki-diff', 'stat-preset-diff']
        .forEach(id => _setText(id, '-'));

    _showNavLinks(false);

    resetConflictFilter();
    _conflictCatCounts = new Map();
}

// ===== Private - conflict table =====

function _buildConflictThead(groupCounts) {
    const frag = _cloneAndTranslate('tpl-thead-conflicts');
    const thNodes = frag.querySelector('th.col-nodes');
    if (thNodes && groupCounts.size > 0) {
        thNodes.appendChild(_buildFilterDropdown(groupCounts));
    }
    return frag;
}

function _buildConflictRow(loc, conflict, rowNum) {
    const row = _cloneEl('tpl-conflict-row');
    _fill(row, 'row-num', rowNum);
    _fill(row, 'track-code', loc.trackCode || '-');
    _fill(row, 'direction', conflict.direction);
    _fill(row, 'placement', conflict.placement);

    const link = row.querySelector('a.gmaps-link');
    link.textContent = loc.milepost || (loc.lat.toFixed(5) + ',' + loc.lng.toFixed(5));
    link.dataset.lat = loc.lat;
    link.dataset.lng = loc.lng;

    const nodesList = row.querySelector('.nodes-list');
    conflict.nodes.forEach((node, i) =>
        nodesList.appendChild(_buildNodeRow(node, i + 1, conflict.isMech))
    );

    return row;
}

function _buildNodeRow(node, index, isMech) {
    const row = _cloneEl('tpl-node-row');
    _fill(row, 'idx', '#' + index);

    const mechIconEl = row.querySelector('.node-mech-icon svg');
    if (mechIconEl) mechIconEl.classList.toggle('is-hidden', !isMech);
    if (isMech) {
        const mechSpan = row.querySelector('.node-mech-icon');
        if (mechSpan) mechSpan.title = t('tooltip.mechanical');
    }

    const hasDupType = node.feats.some(f => f.p.isDupType);
    const labelEl = row.querySelector('.node-label');
    if (labelEl) {
        labelEl.classList.toggle('node-label--dup-type', hasDupType);
        if (hasDupType) labelEl.title = t('tooltip.duplicate');
    }

    const chips = row.querySelector('.node-chips');
    const sorted = [...node.feats].sort(
        (a, b) => getTypePriority(a.p.signalType) - getTypePriority(b.p.signalType)
    );
    for (const feat of sorted) chips.appendChild(_buildChip(feat));
    return row;
}

function _buildChip(feat) {
    const mapping = getMappingEntry(feat.p.signalType);
    const color = _catColorFromMapping(mapping);
    const chip = _cloneEl(mapping ? 'tpl-chip' : 'tpl-chip-unmap');
    chip.style.borderLeftColor = color;
    _fill(chip, 'sncf-type', feat.p.signalType || '(empty)');
    if (mapping) _fill(chip, 'cat', mapping.subcat ? `${mapping.cat}:${mapping.subcat}` : mapping.cat);

    if (feat.p.networkId) {
        const idEl = chip.querySelector('[data-field="chip-id"]');
        if (idEl) {
            idEl.textContent = feat.p.networkId;
            if (feat.p.isDupId) {
                idEl.classList.add('chip-id--dup');
                idEl.style.setProperty('--chip-id-dup-bg', color);
                idEl.style.setProperty('--chip-id-dup-fg', contrastColor(color));
            }
        }
    }

    if (feat.p.networkId) {
        chip.href = APP_URL + '/?networkId=' + encodeURIComponent(feat.p.networkId);
    } else {
        chip.removeAttribute('href');
        chip.style.pointerEvents = 'none';
    }
    return chip;
}


// ===== Private - filter dropdown =====

/**
 * Aggregate OSM cat counts into a group structure for the filter dropdown.
 * Groups are sorted by total conflict count descending.
 * Cats within each group are sorted alphabetically.
 *
 * @param {Map<string, number>} catCounts
 * @returns {Array<{groupKey, label, color, totalCount, cats: Array<{cat, count}>}>}
 */
function _buildGroupedCats(catCounts) {
    // Aggregate cats into groups.
    const groupMap = new Map();
    for (const [cat, count] of catCounts) {
        const groupKey = getGroupForCat(cat) ?? getUnsupportedGroup();
        if (!groupMap.has(groupKey)) {
            groupMap.set(groupKey, {
                groupKey,
                color: getColorForGroup(groupKey),
                totalCount: 0,
                cats: [],
            });
        }
        const g = groupMap.get(groupKey);
        g.totalCount += count;
        g.cats.push({ cat, count });
    }

    // Sort cats within each group alphabetically, groups by count desc.
    for (const g of groupMap.values()) {
        g.cats.sort((a, b) => a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : 0);
    }
    return [...groupMap.values()].sort((a, b) => b.totalCount - a.totalCount);
}

function _buildFilterDropdown(catCounts) {
    _getFilterTemplates();

    const wrap = _tplFilterBtnWrap.content.cloneNode(true).querySelector('.filter-btn-wrap');
    const btn = wrap.querySelector('.filter-dropdown-btn');
    const menu = wrap.querySelector('.filter-dropdown');

    translateElement(wrap);

    const groups = _buildGroupedCats(catCounts);

    // Shared onChange: syncs menu, button, filters, hash after any state mutation.
    const _onChange = () => {
        _syncMenu(menu, groups);
        _syncBtn(btn);
    };

    // "All" row — selects/deselects everything.
    menu.appendChild(_makeAllItem(() => {
        isMechanicalShown() = true;
        _onChange();
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    }));

    // "Mechanical" row — toggles mechanical conflict rows.
    menu.appendChild(_makeMechanicalItem(_onChange));

    // Group rows + their cat children.
    for (const group of groups) {
        menu.appendChild(_makeGroupItem(group, _onChange));
        for (const { cat, count } of group.cats) {
            menu.appendChild(_makeCatItem(cat, count, group.color, _onChange));
        }
    }

    btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open) _syncMenu(menu, groups);
    });

    const ac = new AbortController();
    document.addEventListener('click', () => {
        if (!menu.hidden) {
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
        }
    }, { signal: ac.signal });
    menu.addEventListener('click', e => e.stopPropagation());

    new MutationObserver((_, obs) => {
        if (!wrap.isConnected) { ac.abort(); obs.disconnect(); }
    }).observe(document.body, { childList: true, subtree: true });

    return wrap;
}

/** Build the "All" dropdown row. */
function _makeAllItem(onChange) {
    _getFilterTemplates();
    const item = _tplFilterAllItem.content.cloneNode(true).querySelector('.filter-dropdown-item');
    translateElement(item);
    const isSelected = !isFilterActive();
    item.classList.toggle('is-selected', isSelected);
    const chk = item.querySelector('.filter-item-chk');
    if (chk) { chk.checked = isSelected; chk.dataset.role = 'all'; }
    item.addEventListener('click', e => { e.preventDefault(); onChange(); });
    return item;
}

/** Build the "Mechanical" dropdown row. */
function _makeMechanicalItem(onChange) {
    _getFilterTemplates();
    const item = _tplFilterCatItem.content.cloneNode(true).querySelector('.filter-dropdown-item');
    item.classList.add('item-mechanical');
    item.classList.toggle('is-selected', isMechanicalShown());
    item.style.setProperty('--item-color', 'var(--text-dim)');
    const chk = item.querySelector('.filter-item-chk');
    if (chk) { chk.checked = isMechanicalShown(); chk.dataset.role = 'mechanical'; }
    const label = item.querySelector('.filter-item-label');
    if (label) {
        label.textContent = t('filter.mechanical');
        // Clone gear icon from template — no SVG construction in JS.
        const tpl = document.getElementById('tpl-filter-mech-icon');
        const gearEl = tpl?.content.cloneNode(true).firstElementChild ?? null;
        if (gearEl) label.after(gearEl);
    }
    item.addEventListener('click', e => {
        e.preventDefault();
        toggleMechanical(!isMechanicalShown());
        onChange();
    });
    return item;
}

/**
 * Build a group header row. Clicking it toggles all cats in the group.
 * The row is indented 0; cat rows are indented via CSS class .item-cat.
 */
function _makeGroupItem(group, onChange) {
    _getFilterTemplates();
    const item = _tplFilterCatItem.content.cloneNode(true).querySelector('.filter-dropdown-item');
    item.classList.add('item-group');
    item.dataset.groupKey = group.groupKey;

    const allExcluded = group.cats.every(({ cat }) => isCatExcluded(cat));
    item.classList.toggle('is-selected', !allExcluded);
    item.style.setProperty('--item-color', group.color);

    const chk = item.querySelector('.filter-item-chk');
    if (chk) { chk.checked = !allExcluded; chk.dataset.role = 'group'; chk.dataset.groupKey = group.groupKey; }

    const label = item.querySelector('.filter-item-label');
    if (label) {
        label.textContent = t('group.' + group.groupKey)
            + ' (' + group.totalCount + ')';
    }

    item.addEventListener('click', e => {
        e.preventDefault();
        // Re-compute allExcluded at click time, not at creation time.
        const nowAllExcluded = group.cats.every(({ cat }) => isCatExcluded(cat));
        if (nowAllExcluded) {
            group.cats.forEach(({ cat }) => { if (isCatExcluded(cat)) toggleCat(cat); });
        } else {
            group.cats.forEach(({ cat }) => { if (!isCatExcluded(cat)) toggleCat(cat); });
        }
        onChange();
    });
    return item;
}

/** Build an individual OSM cat row, indented under its group. */
function _makeCatItem(cat, count, color, onChange) {
    _getFilterTemplates();
    const item = _tplFilterCatItem.content.cloneNode(true).querySelector('.filter-dropdown-item');
    item.classList.add('item-cat');
    item.classList.toggle('is-selected', !isCatExcluded(cat));
    item.style.setProperty('--item-color', color);

    const chk = item.querySelector('.filter-item-chk');
    if (chk) { chk.checked = !isCatExcluded(cat); chk.dataset.cat = cat; }

    const label = item.querySelector('.filter-item-label');
    if (label) label.textContent = cat + ' (' + count + ')';

    item.addEventListener('click', e => {
        e.preventDefault();
        toggleCat(cat);
        onChange();
    });
    return item;
}

/**
 * Sync all dropdown item states from current filter state (conflict-filter.js).
 */
function _syncMenu(menu, groups) {
    // All row
    const allItem = menu.querySelector('.item-all');
    const allSelected = !isFilterActive();
    if (allItem) {
        allItem.classList.toggle('is-selected', allSelected);
        const chk = allItem.querySelector('.filter-item-chk');
        if (chk) chk.checked = allSelected;
    }

    // Mechanical row
    const mechItem = menu.querySelector('.item-mechanical');
    if (mechItem) {
        mechItem.classList.toggle('is-selected', isMechanicalShown());
        const chk = mechItem.querySelector('.filter-item-chk');
        if (chk) chk.checked = isMechanicalShown();
    }

    // Group rows
    for (const group of groups) {
        const groupItem = menu.querySelector(`.item-group[data-group-key="${CSS.escape(group.groupKey)}"]`);
        if (groupItem) {
            const allExcluded = group.cats.every(({ cat }) => isCatExcluded(cat));
            groupItem.classList.toggle('is-selected', !allExcluded);
            const chk = groupItem.querySelector('.filter-item-chk');
            if (chk) chk.checked = !allExcluded;
        }
    }

    // Cat rows
    for (const group of groups) {
        for (const { cat } of group.cats) {
            const chk = menu.querySelector(`.filter-item-chk[data-cat="${CSS.escape(cat)}"]`);
            if (!chk) continue;
            const selected = !isCatExcluded(cat);
            chk.checked = selected;
            const item = chk.closest('.filter-dropdown-item');
            if (item) item.classList.toggle('is-selected', selected);
        }
    }
}

function _syncBtn(btn) {
    btn.classList.toggle('is-active', isFilterActive());
}

function _el(id) { return document.getElementById(id); }

/** Set textContent of element with given id. */
function _setText(id, text) {
    const el = _el(id);
    if (el) el.textContent = text;
}

/** Show a result section (unhide + add .visible). */
function _show(id) {
    const el = _el(id);
    if (!el) return;
    el.hidden = false;
    el.classList.add('visible');
}

/** Reveal nav links once results exist. */
function _showNavLinks(show = true) {
    // Toggle only the result section links and their separators.
    // The app link (Signalisation Permanente) is always visible.
    document.querySelectorAll('.header-nav-result, .header-nav-sep-results')
        .forEach(el => { el.hidden = !show; });
    // Show/hide btn-toc along with nav links.
    _el('btn-toc')?.classList.toggle('visible', show);
}

/** Clone a <template> by id and return its root element. */
function _cloneEl(templateId) {
    return document.getElementById(templateId).content.cloneNode(true).firstElementChild;
}

/** Clone a <template>, translate it, and return its DocumentFragment. */
function _cloneAndTranslate(templateId) {
    const frag = document.getElementById(templateId).content.cloneNode(true);
    translateElement(frag);
    return frag;
}

/** Set [data-field] element's textContent inside a cloned template. */
function _fill(root, field, value) {
    const el = root.querySelector(`[data-field="${field}"]`);
    if (el) el.textContent = value;
}

/**
 * Set text and highlight classes on a spec table cell.
 * value=null renders an em-dash placeholder with the dim class.
 *
 * @param {Element|null} cell
 * @param {string|null}  value
 * @param {boolean}      isHighlight  Apply text-amber.
 * @param {boolean}      isDim        Apply dim (typically when value is null).
 */
function _setSpecCell(cell, value, isHighlight, isDim) {
    if (!cell) return;
    cell.textContent = value ?? '—';
    cell.classList.toggle('text-amber', isHighlight);
    cell.classList.toggle('dim', isDim);
}

/**
 * Build the merged "unmatched" row list shared by the wiki/code spec diff and
 * the wiki/preset diff. Each side contributes {cat, type} entries; rows are
 * keyed by keyFn(cat). A case-insensitive value match on the same key collapses
 * the two sides onto one row ({a} from the first list, {b} from the second).
 *
 * @param {Array<{cat,type}>} onlyA  Entries unique to the reference side (-> a).
 * @param {Array<{cat,type}>} onlyB  Entries unique to the other side (-> b).
 * @param {(cat: string) => string} keyFn  Maps a cat to its display/merge key.
 * @returns {Array<{ key: string, a: string|null, b: string|null }>} sorted rows
 */
function _buildUnmatchedRows(onlyA, onlyB, keyFn) {
    const rows = [];
    const indexByNorm = new Map(); // key + '|' + lowercased value -> row index

    for (const { cat, type } of onlyA) {
        const key = keyFn(cat);
        indexByNorm.set(key + '|' + type.toLowerCase(), rows.length);
        rows.push({ key, a: type, b: null });
    }
    for (const { cat, type } of onlyB) {
        const key = keyFn(cat);
        const idx = indexByNorm.get(key + '|' + type.toLowerCase());
        if (idx !== undefined) rows[idx].b = type;
        else rows.push({ key, a: null, b: type });
    }

    rows.sort((x, y) =>
        x.key.localeCompare(y.key) ||
        (x.a ?? '').localeCompare(y.a ?? '') ||
        (x.b ?? '').localeCompare(y.b ?? '')
    );
    return rows;
}

/** Sets of the distinct values present in each column (for cross-column highlight). */
function _typeColumnSets(rows) {
    return {
        aSet: new Set(rows.filter(r => r.a).map(r => r.a)),
        bSet: new Set(rows.filter(r => r.b).map(r => r.b)),
    };
}

function _renderSpecTable({ contentId, badgeId, items, emptyMsg, theadId, rowId,
    emptyBadge, filledBadge, fillRow }) {
    const content = _el(contentId);
    const badge = _el(badgeId);
    if (!content || !badge) return;

    if (!items.length) {
        // Use the template — no HTML construction in JS.
        const noRes = _cloneEl('tpl-no-results');
        _fill(noRes, 'message', emptyMsg);
        content.replaceChildren(noRes);
        badge.textContent = '0';
        badge.className = `badge ${emptyBadge}`;
        // Close the parent <details> when empty — nothing useful to show.
        const details = content.closest('details');
        if (details) details.open = false;
        return;
    }

    badge.textContent = items.length;
    badge.className = `badge ${filledBadge}`;

    const table = _cloneEl('tpl-table');
    table.className += ' spec-table';
    table.appendChild(_cloneAndTranslate(theadId));

    const tbody = _cloneEl('tpl-tbody');
    items.forEach((item, i) => {
        const row = _cloneEl(rowId);
        fillRow(row, item, i);
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    content.replaceChildren(table);
}

function _registerGoogleMapsDelegate(root) {
    root.querySelectorAll('a[data-lat][data-lng]').forEach(a => {
        a.href = `https://www.google.com/maps?q=${a.dataset.lat},${a.dataset.lng}`;
    });
}

/**
 * report-renderer.js — DOM rendering for all validation report sections.
 *
 * Pure presentation layer: receives pre-computed data and populates the DOM
 * exclusively via <template> elements declared in validate.html.
 * Contains no HTML string literals and no analysis logic.
 *
 * OSM map links are lazy: the href is built only on the first pointerenter
 * event over the link, via a single delegated listener per content container.
 * No OSM URL is constructed or requested until the user hovers the link.
 *
 * Public API:
 *   renderStats(stats)
 *   renderConflicts(conflicts)
 *   renderUnmapped(unmappedTypes)
 *   renderSpecDiff(diffResult)
 *   clearResults()
 */

import { SIGNAL_MAPPING } from '../signal-types.js';

// ===== Public API =====

/**
 * Populate the stats cards and optionally reveal the spec-diff row.
 *
 * @param {{
 *   tiles: number, signals: number, locations: number,
 *   conflicts: number, unmappedTypes: number,
 *   wikiPairs?: number, matched?: number,
 *   onlyInWiki?: number, onlyInCode?: number
 * }} stats
 */
export function renderStats(stats) {
    _setText('stat-tiles',     stats.tiles.toLocaleString());
    _setText('stat-signals',   stats.signals.toLocaleString());
    _setText('stat-locations', stats.locations.toLocaleString());
    _setText('stat-conflicts', stats.conflicts.toLocaleString());
    _setText('stat-unmapped',  stats.unmappedTypes.toLocaleString());

    if (stats.wikiPairs !== undefined) {
        _setText('stat-wiki-pairs', stats.wikiPairs.toLocaleString());
        _setText('stat-matched',    stats.matched.toLocaleString());
        _setText('stat-only-wiki',  stats.onlyInWiki.toLocaleString());
        _setText('stat-only-code',  stats.onlyInCode.toLocaleString());
        _show('stats-spec-row');
    }

    _show('stats-grid');
}

/**
 * Render the co-location conflicts section.
 *
 * @param {Array<{
 *   key: string, lat: number, lng: number,
 *   dirConflicts: Array<{ direction: string, nodes: object[], dupCats: string[] }>
 * }>} conflicts
 */
export function renderConflicts(conflicts) {
    const badge   = _el('badge-conflicts');
    const content = _el('conflicts-content');

    badge.textContent = conflicts.length;
    _show('section-conflicts');

    if (conflicts.length === 0) {
        badge.className = 'badge badge-green';
        content.replaceChildren(_noResults('No co-location conflicts detected.'));
        return;
    }

    badge.className = 'badge badge-red';

    const table = document.createElement('table');
    table.className = 'data-table';
    table.appendChild(_clone('tpl-thead-conflicts'));

    const tbody = document.createElement('tbody');
    for (const conflict of conflicts) {
        tbody.appendChild(_buildConflictRow(conflict));
    }
    table.appendChild(tbody);
    content.replaceChildren(table);

    // One delegated listener for the whole table — builds OSM href on first hover.
    _registerOsmLinkDelegate(content);
}

/**
 * Render the unmapped signal types section.
 *
 * @param {Map<string, { count: number, networkIds: Set<string> }>} unmappedTypes
 */
export function renderUnmapped(unmappedTypes) {
    const badge   = _el('badge-unmapped');
    const content = _el('unmapped-content');

    badge.textContent = unmappedTypes.size;
    _show('section-unmapped');

    if (unmappedTypes.size === 0) {
        badge.className = 'badge badge-green';
        content.replaceChildren(_noResults('All signal types are mapped in signal-types.js.'));
        return;
    }

    badge.className = 'badge badge-amber';

    const table = document.createElement('table');
    table.className = 'data-table';
    table.appendChild(_clone('tpl-thead-unmapped'));

    const tbody  = document.createElement('tbody');
    const sorted = [...unmappedTypes.entries()].sort((a, b) => b[1].count - a[1].count);

    for (const [type, info] of sorted) {
        const row     = _cloneEl('tpl-unmapped-row');
        const ids     = [...info.networkIds].slice(0, 5);
        const overflowCount = info.networkIds.size - ids.length;

        _fill(row, 'type',     type || '(empty)');
        _fill(row, 'count',    info.count.toLocaleString());
        _fill(row, 'ids',      ids.join(', '));
        _fill(row, 'overflow', overflowCount > 0 ? ` +${overflowCount} more` : '');

        tbody.appendChild(row);
    }

    table.appendChild(tbody);
    content.replaceChildren(table);
}

/**
 * Render the wiki spec diff section.
 *
 * @param {{ matched: object[], onlyInWiki: object[], onlyInCode: object[] }} diffResult
 */
export function renderSpecDiff(diffResult) {
    const { matched, onlyInWiki, onlyInCode } = diffResult;
    _show('section-spec');

    // Only in wiki — not implemented in signal-types.js.
    _renderSpecTable({
        contentId:   'only-wiki-content',
        badgeId:     'badge-only-wiki',
        items:       onlyInWiki,
        emptyMsg:    'All wiki-defined types are implemented in signal-types.js.',
        theadTplId:  'tpl-thead-spec-wiki',
        rowTplId:    'tpl-spec-row-wiki',
        emptyBadge:  'badge-green',
        filledBadge: 'badge-red',
        fillRow(row, { cat, type }) {
            _fill(row, 'key',  `railway:signal:${cat}`);
            _fill(row, 'type', type);
        },
    });

    // Only in code — absent from wiki.
    // Sorted: catKnown=true (type mismatch, most actionable) first.
    _renderSpecTable({
        contentId:   'only-code-content',
        badgeId:     'badge-only-code',
        items:       [...onlyInCode].sort((a, b) => Number(b.catKnown) - Number(a.catKnown)),
        emptyMsg:    'All signal-types.js entries match the wiki spec.',
        theadTplId:  'tpl-thead-spec-code',
        rowTplId:    'tpl-spec-row-code',
        emptyBadge:  'badge-green',
        filledBadge: 'badge-amber',
        fillRow(row, { cat, type, sncfKeys, catKnown }) {
            _fill(row, 'key', `railway:signal:${cat}`);

            const typeEl = row.querySelector('[data-field="type"]');
            typeEl.textContent = type;
            typeEl.classList.add(catKnown ? 'text-red' : 'text-dim');

            _fillCodeChips(row.querySelector('[data-field="sncf-keys"]'), sncfKeys);

            const noteEl = row.querySelector('[data-field="note"]');
            if (catKnown) {
                noteEl.textContent = 'type mismatch \u2014 cat exists in wiki with different value';
                noteEl.className = 'text-red';
            } else {
                noteEl.textContent = 'cat absent from wiki \u2014 extension or undocumented';
                noteEl.className = 'dim';
            }
        },
    });

    // Matched — present in both sources.
    _renderSpecTable({
        contentId:   'matched-content',
        badgeId:     'badge-matched',
        items:       matched,
        emptyMsg:    'No matches found.',
        theadTplId:  'tpl-thead-spec-matched',
        rowTplId:    'tpl-spec-row-matched',
        emptyBadge:  'badge-green',
        filledBadge: 'badge-green',
        fillRow(row, { cat, type, sncfKeys }) {
            _fill(row, 'key',  `railway:signal:${cat}`);
            _fill(row, 'type', type);
            _fillCodeChips(row.querySelector('[data-field="sncf-keys"]'), sncfKeys);
        },
    });
}

/** Hide all result sections and reset stat card values to em-dash. */
export function clearResults() {
    const sections = [
        'stats-grid', 'stats-spec-row',
        'section-conflicts', 'section-unmapped', 'section-spec',
    ];
    for (const id of sections) _el(id)?.classList.remove('visible');

    const stats = [
        'stat-tiles', 'stat-signals', 'stat-locations',
        'stat-conflicts', 'stat-unmapped',
        'stat-wiki-pairs', 'stat-matched', 'stat-only-wiki', 'stat-only-code',
    ];
    for (const id of stats) _setText(id, '\u2014');
}


// ===== Private — conflict rendering =====

/**
 * Build a complete <tr> for one conflicting location.
 *
 * @param {{ key: string, lat: number, lng: number, dirConflicts: object[] }} conflict
 * @returns {HTMLTableRowElement}
 */
function _buildConflictRow(conflict) {
    const row  = _cloneEl('tpl-conflict-row');

    _fill(row, 'key', conflict.key);

    // Coordinates displayed immediately; href built lazily on first hover.
    const link = row.querySelector('a.osm-link');
    link.textContent  = `${conflict.lat.toFixed(5)},\u2009${conflict.lng.toFixed(5)}`;
    link.dataset.lat  = conflict.lat;
    link.dataset.lng  = conflict.lng;

    const cell = row.querySelector('.nodes-cell');
    for (const dc of conflict.dirConflicts) {
        cell.appendChild(_buildDirBlock(dc));
    }

    return row;
}

/**
 * Build a direction block (one per conflicting direction within a location).
 *
 * @param {{ direction: string, nodes: object[], dupCats: string[] }} dc
 * @returns {HTMLElement}
 */
function _buildDirBlock(dc) {
    const block = _cloneEl('tpl-dir-block');

    _fill(block, 'direction',  dc.direction);
    _fill(block, 'node-count', dc.nodes.length);

    const list = block.querySelector('.nodes-list');
    dc.nodes.forEach((node, i) => list.appendChild(_buildNodeRow(node, i + 1)));

    if (dc.dupCats.length > 0) {
        const el = block.querySelector('.conflict-reason');
        el.removeAttribute('hidden');
        // Build text node + <code> elements without any HTML string.
        el.appendChild(document.createTextNode('\u21b3 duplicate cat: '));
        dc.dupCats.forEach((cat, i) => {
            const code = document.createElement('code');
            code.textContent = cat;
            el.appendChild(code);
            if (i < dc.dupCats.length - 1) el.appendChild(document.createTextNode(', '));
        });
    }

    return block;
}

/**
 * Build a node row (index + signal chips) inside a direction block.
 *
 * @param {{ feats: object[], categories: Set<string> }} node
 * @param {number} index  1-based display index
 * @returns {HTMLElement}
 */
function _buildNodeRow(node, index) {
    const row = _cloneEl('tpl-conflict-node');
    _fill(row, 'idx', `#${index}`);

    const chips = row.querySelector('.node-chips');
    for (const feat of node.feats) {
        chips.appendChild(_buildChip(feat));
    }

    return row;
}

/**
 * Build a signal chip from the appropriate template.
 *
 * @param {{ p: { signalType: string } }} feat
 * @returns {HTMLElement}
 */
function _buildChip(feat) {
    const mapping = SIGNAL_MAPPING[feat.p.signalType];

    if (!mapping) {
        const chip = _cloneEl('tpl-chip-unmap');
        _fill(chip, 'sncf-type', feat.p.signalType || '(empty)');
        chip.title = 'unmapped';
        return chip;
    }

    const chip = _cloneEl('tpl-chip');
    _fill(chip, 'sncf-type', feat.p.signalType);
    _fill(chip, 'cat',       mapping.cat);
    return chip;
}


// ===== Private — spec diff rendering =====

/**
 * Generic helper to populate one spec diff sub-section.
 *
 * @param {{
 *   contentId: string, badgeId: string,
 *   items: object[], emptyMsg: string,
 *   theadTplId: string, rowTplId: string,
 *   emptyBadge: string, filledBadge: string,
 *   fillRow: (row: HTMLElement, item: object) => void
 * }} opts
 */
function _renderSpecTable(opts) {
    const badge   = _el(opts.badgeId);
    const content = _el(opts.contentId);

    badge.textContent = opts.items.length;

    if (opts.items.length === 0) {
        badge.className = `badge ${opts.emptyBadge}`;
        content.replaceChildren(_noResults(opts.emptyMsg));
        return;
    }

    badge.className = `badge ${opts.filledBadge}`;

    const table = document.createElement('table');
    table.className = 'data-table';
    table.appendChild(_clone(opts.theadTplId));

    const tbody = document.createElement('tbody');
    for (const item of opts.items) {
        const row = _cloneEl(opts.rowTplId);
        opts.fillRow(row, item);
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    content.replaceChildren(table);
}

/**
 * Append <code> chips for each SNCF key into a cell element.
 * Uses only DOM methods — no innerHTML.
 *
 * @param {HTMLElement} cell
 * @param {string[]}    sncfKeys
 */
function _fillCodeChips(cell, sncfKeys) {
    sncfKeys.forEach((key, i) => {
        const code = document.createElement('code');
        code.textContent = key;
        cell.appendChild(code);
        if (i < sncfKeys.length - 1) cell.appendChild(document.createTextNode(' '));
    });
}


// ===== Private — lazy OSM links =====

/**
 * Register a single delegated pointerenter listener on a container.
 * On first hover over an .osm-link, builds and assigns the OSM href.
 * Subsequent hovers are no-ops (dataset.hrefReady guard).
 *
 * @param {HTMLElement} container
 */
function _registerOsmLinkDelegate(container) {
    container.addEventListener('pointerenter', e => {
        const link = e.target.closest('a.osm-link[data-lat][data-lng]');
        if (!link || link.dataset.hrefReady) return;

        const { lat, lng } = link.dataset;
        link.href              = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
        link.dataset.hrefReady = '1';
    }, true);   // capture phase: fires before any child handler
}


// ===== Private — template helpers =====

/**
 * Clone a <template> by id and return its single root element.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
function _cloneEl(id) {
    return document.getElementById(id).content.cloneNode(true).firstElementChild;
}

/**
 * Clone a <template> by id and return the DocumentFragment.
 * Use when the template contains multiple root-level nodes (e.g. <thead>).
 *
 * @param {string} id
 * @returns {DocumentFragment}
 */
function _clone(id) {
    return document.getElementById(id).content.cloneNode(true);
}

/**
 * Set the textContent of the first [data-field] match within a cloned element.
 *
 * @param {HTMLElement}   root
 * @param {string}        field
 * @param {string|number} value
 */
function _fill(root, field, value) {
    const el = root.matches(`[data-field="${field}"]`)
        ? root
        : root.querySelector(`[data-field="${field}"]`);
    if (el) el.textContent = value;
}

/** Build a no-results placeholder from the shared template. */
function _noResults(message) {
    const el = _cloneEl('tpl-no-results');
    el.textContent = `\u2713 ${message}`;
    return el;
}

function _el(id)         { return document.getElementById(id); }
function _setText(id, v) { const e = _el(id); if (e) e.textContent = v; }
function _show(id)       { _el(id)?.classList.add('visible'); }

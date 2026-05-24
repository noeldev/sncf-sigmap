/**
 * report-renderer.js - DOM rendering for all validation report sections.
 *
 * Pure presentation layer: no analysis logic, no HTML strings.
 * All structure comes from <template> elements in validate.html.
 *
 * Chips: the entire <a> element is the clickable target.
 * Conflicting chips receive .chip-conflict (soft dark-red border).
 *
 * OSM map links: href built lazily on first pointerenter via one delegated
 * listener per table — no URL constructed at render time.
 *
 * App signal links (/?networkId=...): same-origin relative URL, set immediately.
 *
 * Public API:
 *   renderStats(stats)
 *   renderConflicts(conflicts)
 *   renderUnmapped(unmappedTypes)
 *   renderSpecDiff(diffResult)
 *   clearResults()
 */

import { SIGNAL_MAPPING } from '../signal-types.js';
import { initCollapsiblePanelsInRoot } from '../collapsible-panel.js';

const APP_SIGNAL_URL = '.';

// Wire collapsible panels once the module loads (DOM is ready at this point).
initCollapsiblePanelsInRoot(document.getElementById('main'));

// Floating back-to-top button.
document.getElementById('btn-toc')?.addEventListener('click', () => {
    document.querySelector('.page-header')?.scrollIntoView({ behavior: 'smooth' });
});

// ===== Public API =====

export function renderStats(stats) {
    _setText('stat-tiles', stats.tiles.toLocaleString());
    _setText('stat-signals', stats.signals.toLocaleString());
    _setText('stat-locations', stats.locations.toLocaleString());
    _setText('stat-conflicts', stats.conflicts.toLocaleString());
    _setText('stat-unmapped', stats.unmappedTypes.toLocaleString());

    if (stats.wikiPairs !== undefined) {
        _setText('stat-wiki-pairs', stats.wikiPairs.toLocaleString());
        _setText('stat-matched', stats.matched.toLocaleString());
        _setText('stat-only-wiki', stats.onlyInWiki.toLocaleString());
        _setText('stat-only-code', stats.onlyInCode.toLocaleString());
        _show('stats-spec-row');
    }

    _show('stats-grid');
    _updateHeaderNav(stats);
    _el('btn-toc').classList.add('visible');
}

export function renderConflicts(conflicts) {
    const badge = _el('badge-conflicts');
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
    for (const loc of conflicts) {
        for (const conflict of loc.conflicts) {
            tbody.appendChild(_buildConflictRow(loc, conflict));
        }
    }
    table.appendChild(tbody);
    content.replaceChildren(table);

    _registerOsmLinkDelegate(content);
}

export function renderUnmapped(unmappedTypes) {
    const badge = _el('badge-unmapped');
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

    const tbody = document.createElement('tbody');
    const sorted = [...unmappedTypes.entries()].sort((a, b) => b[1].count - a[1].count);

    for (const [type, info] of sorted) {
        const row = _cloneEl('tpl-unmapped-row');
        const ids = [...info.networkIds].slice(0, 5);
        _fill(row, 'type', type || '(empty)');
        _fill(row, 'count', info.count.toLocaleString());
        _fill(row, 'ids', ids.join(', '));
        _fill(row, 'overflow', info.networkIds.size > ids.length
            ? ` +${info.networkIds.size - ids.length} more` : '');
        tbody.appendChild(row);
    }

    table.appendChild(tbody);
    content.replaceChildren(table);
}

export function renderSpecDiff(diffResult) {
    const { matched, onlyInWiki, onlyInCode } = diffResult;
    _show('section-spec');

    // Only in wiki: OSM {cat, type} pairs defined in the wiki but missing from signal-types.js.
    _renderSpecTable({
        contentId: 'only-wiki-content',
        badgeId: 'badge-only-wiki',
        items: onlyInWiki,
        emptyMsg: 'All wiki-defined OSM types are implemented in signal-types.js.',
        theadId: 'tpl-thead-spec-wiki',
        rowId: 'tpl-spec-row-wiki',
        emptyBadge: 'badge-green',
        filledBadge: 'badge-red',
        fillRow(row, { cat, type }) {
            _fill(row, 'key', `railway:signal:${cat}`);
            _fill(row, 'type', type);
        },
    });

    // Only in code: SIGNAL_MAPPING OSM {cat, type} pairs absent from the wiki.
    // Sorted: catKnown=true (type value mismatch, most actionable) first.
    _renderSpecTable({
        contentId: 'only-code-content',
        badgeId: 'badge-only-code',
        items: [...onlyInCode].sort((a, b) => Number(b.catKnown) - Number(a.catKnown)),
        emptyMsg: 'All signal-types.js OSM types match the wiki spec.',
        theadId: 'tpl-thead-spec-code',
        rowId: 'tpl-spec-row-code',
        emptyBadge: 'badge-green',
        filledBadge: 'badge-amber',
        fillRow(row, { cat, type, catKnown }) {
            _fill(row, 'key', `railway:signal:${cat}`);

            const typeEl = row.querySelector('[data-field="type"]');
            typeEl.textContent = type;
            typeEl.classList.add(catKnown ? 'text-amber' : 'text-dim');

            const noteEl = row.querySelector('[data-field="note"]');
            if (catKnown) {
                noteEl.textContent = 'type mismatch - cat known in wiki with a different value';
                noteEl.className = 'text-amber';
            } else {
                noteEl.textContent = 'cat absent from wiki - extension or undocumented';
                noteEl.className = 'dim';
            }
        },
    });

    // Matched: pairs present in both sources (collapsible, starts closed).
    _renderSpecTable({
        contentId: 'matched-content',
        badgeId: 'badge-matched',
        items: matched,
        emptyMsg: 'No matches found.',
        theadId: 'tpl-thead-spec-matched',
        rowId: 'tpl-spec-row-matched',
        emptyBadge: 'badge-green',
        filledBadge: 'badge-green',
        fillRow(row, { cat, type }) {
            _fill(row, 'key', `railway:signal:${cat}`);
            _fill(row, 'type', type);
        },
    });
}

export function clearResults() {
    const sections = [
        'stats-grid', 'stats-spec-row',
        'section-conflicts', 'section-unmapped', 'section-spec',
    ];
    for (const id of sections) _el(id)?.classList.remove('visible');

    const statIds = [
        'stat-tiles', 'stat-signals', 'stat-locations', 'stat-conflicts', 'stat-unmapped',
        'stat-wiki-pairs', 'stat-matched', 'stat-only-wiki', 'stat-only-code',
    ];
    for (const id of statIds) _setText(id, '-');

    _el('btn-toc').classList.remove('visible');

    ['nav-conflicts', 'nav-unmapped', 'nav-spec'].forEach(id => {
        const a = _el(id);
        if (a) a.className = '';
    });
}

// ===== Private - header nav =====

function _updateHeaderNav(stats) {
    const map = [
        ['nav-conflicts', stats.conflicts > 0],
        ['nav-unmapped', stats.unmappedTypes > 0],
        ['nav-spec', stats.onlyInWiki > 0 || stats.onlyInCode > 0],
    ];
    for (const [id, hasIssue] of map) {
        const a = _el(id);
        if (a) a.className = hasIssue ? 'has-conflict' : 'has-results';
    }
}

// ===== Private - conflict row =====

function _buildConflictRow(loc, conflict) {
    const row = _cloneEl('tpl-conflict-row');

    _fill(row, 'track-code', loc.trackCode || '-');
    _fill(row, 'direction', conflict.direction);
    _fill(row, 'placement', conflict.placement);

    const link = row.querySelector('a.osm-link');
    link.textContent = loc.milepost || `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
    link.dataset.lat = loc.lat;
    link.dataset.lng = loc.lng;

    const nodesList = row.querySelector('.nodes-list');
    conflict.nodes.forEach((node, i) => {
        nodesList.appendChild(_buildNodeRow(node, i + 1, conflict.dupCats));
    });

    return row;
}

function _buildNodeRow(node, index, dupCats) {
    const row = _cloneEl('tpl-node-row');
    _fill(row, 'idx', `#${index}`);

    const chips = row.querySelector('.node-chips');
    for (const feat of node.feats) {
        chips.appendChild(_buildChip(feat, dupCats));
    }

    return row;
}

function _buildChip(feat, dupCats) {
    const mapping = SIGNAL_MAPPING[feat.p.signalType];
    const chip = _cloneEl(mapping ? 'tpl-chip' : 'tpl-chip-unmap');
    const isConflict = mapping && dupCats.includes(mapping.cat);

    if (isConflict) chip.classList.add('chip-conflict');

    _fill(chip, 'sncf-type', feat.p.signalType || '(empty)');
    if (mapping) _fill(chip, 'cat', mapping.cat);

    if (feat.p.networkId) {
        chip.href = `${APP_SIGNAL_URL}/?networkId=${encodeURIComponent(feat.p.networkId)}`;
    } else {
        chip.removeAttribute('href');
        chip.style.pointerEvents = 'none';
    }

    return chip;
}

// ===== Private - spec diff table =====

function _renderSpecTable({ contentId, badgeId, items, emptyMsg,
    theadId, rowId, emptyBadge, filledBadge, fillRow }) {
    const badge = _el(badgeId);
    const content = _el(contentId);

    badge.textContent = items.length;

    if (items.length === 0) {
        badge.className = `badge ${emptyBadge}`;
        content.replaceChildren(_noResults(emptyMsg));
        return;
    }

    badge.className = `badge ${filledBadge}`;

    const table = document.createElement('table');
    table.className = 'data-table';
    table.appendChild(_clone(theadId));

    const tbody = document.createElement('tbody');
    for (const item of items) {
        const row = _cloneEl(rowId);
        fillRow(row, item);
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    content.replaceChildren(table);
}

// ===== Private - lazy OSM links =====

function _registerOsmLinkDelegate(container) {
    container.addEventListener('pointerenter', e => {
        const link = e.target.closest('a.osm-link[data-lat][data-lng]');
        if (!link || link.dataset.hrefReady) return;
        const { lat, lng } = link.dataset;
        link.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
        link.dataset.hrefReady = '1';
    }, true);
}

// ===== Private - template helpers =====

function _cloneEl(id) {
    return document.getElementById(id).content.cloneNode(true).firstElementChild;
}

function _clone(id) {
    return document.getElementById(id).content.cloneNode(true);
}

function _fill(root, field, value) {
    const selector = `[data-field="${field}"]`;
    const el = root.matches?.(selector) ? root : root.querySelector(selector);
    if (el) el.textContent = value;
}

function _noResults(message) {
    const el = _cloneEl('tpl-no-results');
    el.textContent = `OK - ${message}`;
    return el;
}

function _el(id) { return document.getElementById(id); }
function _setText(id, v) { const e = _el(id); if (e) e.textContent = v; }
function _show(id) { _el(id)?.classList.add('visible'); }

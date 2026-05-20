/**
 * validate-main.js — Validation orchestrator.
 *
 * Coordinates two independent analysis passes launched in parallel:
 *
 *   Pass A — Tile scan (manifest + tiles):
 *     1. Co-location conflicts via conflict-detector.js / signal-mapping.js logic.
 *     2. Unmapped SNCF types: codes absent from SIGNAL_MAPPING.
 *
 *   Pass B — Spec diff (wiki fetch, no tiles):
 *     3. Cross-check SIGNAL_MAPPING {cat, type} pairs vs wiki-defined pairs.
 *        Rendered as soon as the wiki response arrives, independently of Pass A.
 *
 * normalizeSignal() from sncf-convert.js is the single source of truth for
 * raw SNCF field names — no field name knowledge lives here.
 *
 * Public API:
 *   init()   — wire button event listeners (call once on DOMContentLoaded)
 */

import { SIGNAL_MAPPING }                        from '../signal-types.js';
import { normalizeSignal }                       from '../sncf-convert.js';
import { loadManifest, fetchTileByKey }          from '../tiles.js';
import { fetchWikiSpec }                         from './wiki-parser.js';
import { buildCodeSpec, compareSpecs }           from './spec-compare.js';
import { buildLocationGroups, detectOsmNodes,
         findDirectionConflicts }                from './conflict-detector.js';
import { renderStats, renderConflicts,
         renderUnmapped, renderSpecDiff,
         clearResults }                          from './report-renderer.js';

// ===== Module state =====

let _cancelled   = false;
let _lastResults = null;   // retained for JSON export


// ===== Public API =====

/** Wire all button event handlers. Call once after DOM is ready. */
export function init() {
    document.getElementById('btn-start').addEventListener('click',  _run);
    document.getElementById('btn-cancel').addEventListener('click', () => { _cancelled = true; });
    document.getElementById('btn-export').addEventListener('click', _exportJson);
}


// ===== Run =====

async function _run() {
    _cancelled   = false;
    _lastResults = null;

    _setButtons({ start: false, cancel: true, export: false });
    _setStatus('');
    clearResults();
    _showProgress(true);
    _setProgress(0, 'Fetching wiki spec and tile manifest\u2026');

    // Both fetches start in parallel — no dependency between them.
    const [wikiSpec, manifest] = await Promise.all([
        fetchWikiSpec(),
        loadManifest(),
    ]);

    if (_cancelled) return _onCancel();

    // ── Pass B: spec diff — render immediately, no tiles needed ──
    let specStats = null;
    if (wikiSpec) {
        const codeSpec   = buildCodeSpec(SIGNAL_MAPPING);
        const diffResult = compareSpecs(wikiSpec, codeSpec);
        renderSpecDiff(diffResult);
        specStats = {
            wikiPairs:  wikiSpec.pairs.length,
            matched:    diffResult.matched.length,
            onlyInWiki: diffResult.onlyInWiki.length,
            onlyInCode: diffResult.onlyInCode.length,
            diffResult,
        };
    } else {
        _setStatus('\u26a0 Wiki fetch failed \u2014 spec diff skipped.');
    }

    if (!manifest) {
        _setProgress(0, 'Error: failed to load manifest.json');
        _setButtons({ start: true, cancel: false, export: false });
        return;
    }

    // ── Pass A: tile scan ──
    const tileKeys   = Object.keys(manifest.tiles);
    const totalTiles = tileKeys.length;

    // Accumulate location groups incrementally to avoid a second full pass.
    const locationGroups = new Map();   // groupKey → { lat, lng, key, feats[] }
    const unmappedTypes  = new Map();   // signalType → { count, networkIds: Set }
    let totalSignals = 0;
    let tilesLoaded  = 0;

    for (const tileKey of tileKeys) {
        if (_cancelled) return _onCancel(tilesLoaded, totalTiles);

        const tile = await fetchTileByKey(tileKey);

        // normalizeSignal() is the only knowledge of raw field names here.
        for (const raw of tile) {
            const p = normalizeSignal(raw);
            if (!SIGNAL_MAPPING[p.signalType]) {
                if (!unmappedTypes.has(p.signalType)) {
                    unmappedTypes.set(p.signalType, { count: 0, networkIds: new Set() });
                }
                const entry = unmappedTypes.get(p.signalType);
                entry.count++;
                if (p.networkId) entry.networkIds.add(p.networkId);
            }
        }
        totalSignals += tile.length;

        // Merge tile into running location groups.
        for (const [key, group] of buildLocationGroups([tile])) {
            if (!locationGroups.has(key)) {
                locationGroups.set(key, group);
            } else {
                locationGroups.get(key).feats.push(...group.feats);
            }
        }

        tilesLoaded++;
        _setProgress(
            tilesLoaded / totalTiles,
            `Tile ${tilesLoaded.toLocaleString()} / ${totalTiles.toLocaleString()}`
            + ` \u2014 ${totalSignals.toLocaleString()} signals`
        );
    }

    // ── Conflict detection ──
    _setProgress(1, 'Analysing co-location groups\u2026');

    const conflicts = [];
    for (const loc of locationGroups.values()) {
        const nodes        = detectOsmNodes(loc.feats);
        const dirConflicts = findDirectionConflicts(nodes);
        if (dirConflicts.length > 0) {
            conflicts.push({ key: loc.key, lat: loc.lat, lng: loc.lng, dirConflicts });
        }
    }

    // ── Store for export ──
    _lastResults = { date: new Date().toISOString(), specStats, tileScan: {
        tiles: tilesLoaded, signals: totalSignals,
        locations: locationGroups.size, conflicts, unmappedTypes,
    }};

    // ── Render ──
    renderStats({
        tiles:        tilesLoaded,
        signals:      totalSignals,
        locations:    locationGroups.size,
        conflicts:    conflicts.length,
        unmappedTypes: unmappedTypes.size,
        ...(specStats ? {
            wikiPairs:  specStats.wikiPairs,
            matched:    specStats.matched,
            onlyInWiki: specStats.onlyInWiki,
            onlyInCode: specStats.onlyInCode,
        } : {}),
    });
    renderConflicts(conflicts);
    renderUnmapped(unmappedTypes);

    _setProgress(1,
        `Done \u2014 ${tilesLoaded.toLocaleString()} tiles`
        + ` \u00b7 ${totalSignals.toLocaleString()} signals`
        + ` \u00b7 ${locationGroups.size.toLocaleString()} locations`
        + (conflicts.length ? ` \u00b7 ${conflicts.length} conflict(s)` : ' \u00b7 no conflicts')
    );

    _setButtons({ start: true, cancel: false, export: true });
}


// ===== JSON export =====

function _exportJson() {
    if (!_lastResults) return;

    const { date, specStats, tileScan } = _lastResults;

    const payload = {
        date,
        specDiff: specStats ? {
            wikiUrl:    'https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France',
            wikiPairs:  specStats.wikiPairs,
            matched:    specStats.matched,
            onlyInWiki: specStats.onlyInWiki,
            onlyInCode: specStats.onlyInCode,
            detail:     specStats.diffResult,
        } : null,
        tileScan: {
            tiles:     tileScan.tiles,
            signals:   tileScan.signals,
            locations: tileScan.locations,
            conflicts: tileScan.conflicts.map(c => ({
                key:          c.key,
                lat:          c.lat,
                lng:          c.lng,
                dirConflicts: c.dirConflicts.map(dc => ({
                    direction:   dc.direction,
                    forcedNodes: dc.nodes.length,
                    dupCats:     dc.dupCats,
                    nodes: dc.nodes.map(node => ({
                        signals: node.feats.map(f => ({
                            signalType: f.p.signalType,
                            networkId:  f.p.networkId,
                            cat:        SIGNAL_MAPPING[f.p.signalType]?.cat ?? null,
                        })),
                    })),
                })),
            })),
            unmappedTypes: [...tileScan.unmappedTypes.entries()]
                .sort((a, b) => b[1].count - a[1].count)
                .map(([type, info]) => ({
                    type,
                    count:            info.count,
                    sampleNetworkIds: [...info.networkIds].slice(0, 10),
                })),
        },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: `signal-validation-${date.slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}


// ===== UI helpers =====

function _onCancel(loaded = 0, total = 0) {
    const pct = (loaded && total) ? loaded / total : 0;
    _setProgress(pct, loaded
        ? `Cancelled after ${loaded.toLocaleString()} / ${total.toLocaleString()} tiles.`
        : 'Cancelled.');
    _setButtons({ start: true, cancel: false, export: false });
}

function _setButtons({ start, cancel, export: exp }) {
    document.getElementById('btn-start').disabled  = !start;
    document.getElementById('btn-cancel').disabled = !cancel;
    document.getElementById('btn-export').disabled = !exp;
}

function _setStatus(text)           { document.getElementById('status-text').textContent = text; }
function _showProgress(v)           { document.getElementById('progress-wrap').classList.toggle('visible', v); }
function _setProgress(fraction, label) {
    document.getElementById('progress-fill').style.width =
        `${(Math.min(fraction, 1) * 100).toFixed(1)}%`;
    document.getElementById('progress-label').textContent = label;
}

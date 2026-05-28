/**
 * validate-main.js - Validation orchestrator.
 *
 * Two independent passes launched in parallel:
 *
 *   Pass A - Tile scan (manifest + all tiles):
 *     1. Co-location conflicts  - via conflict-detector.js.
 *     2. Unmapped SNCF types    - codes absent from SIGNAL_MAPPING.
 *
 *   Pass B - Spec diff (wiki fetch only, no tiles):
 *     3. Cross-check SIGNAL_MAPPING {cat, type} OSM values against wiki.
 *        Rendered as soon as the wiki response arrives.
 *
 * Deduplication:
 *   Signals with the same networkId appearing in multiple tiles (e.g. at
 *   bifurcation points referenced by several lines) are deduplicated per
 *   location group before conflict detection. Controlled by a checkbox so
 *   the user can compare results with and without deduplication.
 *
 * Stats note:
 *   conflictLocations = number of location groups with at least one conflict.
 *   conflictRows      = total direction+placement conflict entries (table rows).
 *
 * GeoJSON export:
 *   Exports ALL signals as a FeatureCollection for OSM integration.
 *   Conflict locations are flagged with has_conflict=true and conflict details.
 *   Compatible with JOSM, QGIS, MapRoulette, and any GIS tool.
 *
 * Shared modules (unchanged from main app):
 *   sncf-convert.js, signal-types.js, signal-grouping.js, tiles.js, cat-mapping.js.
 *
 * Entry point: init() called at module scope (ES modules are deferred by default).
 */

import { SIGNAL_MAPPING } from '../signal-types.js';
import { normalizeSignal } from '../sncf-convert.js';
import { loadManifest, fetchTileByKey } from '../tiles.js';
import { buildNodeTags } from '../osm-tags.js';
import { fetchWikiSpec } from './wiki-parser.js';
import { buildCodeSpec, compareSpecs } from './spec-compare.js';
import {
    buildLocationGroups, detectOsmNodes,
    findConflicts
} from './conflict-detector.js';
import {
    renderStats, renderConflicts,
    renderUnmapped, renderSpecDiff,
    clearResults, hideProgress
} from './report-renderer.js';

// ===== State =====

let _cancelled = false;
let _lastResults = null;
let _dedup = true;

// ===== Entry point =====

init();

export function init() {
    document.getElementById('btn-start').addEventListener('click', _run);
    document.getElementById('btn-cancel').addEventListener('click', () => { _cancelled = true; });
    document.getElementById('btn-export').addEventListener('click', _exportGeoJSON);
    document.getElementById('chk-dedup')?.addEventListener('change', e => { _dedup = e.target.checked; });
}

// ===== Run =====

async function _run() {
    _cancelled = false;
    _lastResults = null;

    _setButtons({ start: false, cancel: true, export: false });
    _setStatus('');
    clearResults();
    _showProgress(true);
    _setProgress(0, 'Fetching wiki spec and tile manifest...');

    const [wikiSpec, manifest] = await Promise.all([fetchWikiSpec(), loadManifest()]);

    if (_cancelled) return _onCancel();

    // Pass B: spec diff.
    let specStats = null;
    if (wikiSpec) {
        const diffResult = compareSpecs(wikiSpec, buildCodeSpec(SIGNAL_MAPPING));
        renderSpecDiff(diffResult);
        specStats = {
            wikiPairs: wikiSpec.pairs.length,
            matched: diffResult.matched.length,
            onlyInWiki: diffResult.onlyInWiki.length,
            onlyInCode: diffResult.onlyInCode.length,
        };
    } else {
        _setStatus('Warning: wiki fetch failed - spec diff skipped.');
    }

    if (!manifest) {
        _setProgress(0, 'Error: failed to load manifest.json');
        _setButtons({ start: true, cancel: false, export: false });
        return;
    }

    // Pass A: tile scan.
    const { locationGroups, unmappedTypes, totalSignals, tilesLoaded } =
        await _scanTiles(Object.keys(manifest.tiles));

    if (_cancelled) return _onCancel(tilesLoaded, Object.keys(manifest.tiles).length);

    // Optional deduplication by networkId.
    const dedupedCount = _dedup ? _deduplicateGroups(locationGroups) : 0;

    // Conflict detection.
    _setProgress(1, 'Analysing co-location groups...');
    const { conflicts, conflictRows } = _detectConflicts(locationGroups);

    _lastResults = {
        date: new Date().toISOString(),
        specStats,
        dedupedCount,
        tileScan: {
            tiles: tilesLoaded,
            signals: totalSignals,
            locations: locationGroups.size,
            conflicts,
            conflictRows,
            unmappedTypes,
            locationGroups, // retained for all-signals GeoJSON export
        },
    };

    renderStats({
        tiles: tilesLoaded,
        signals: totalSignals,
        locations: locationGroups.size,
        conflictLocations: conflicts.length,
        unmappedTypes: unmappedTypes.size,
        dedupedCount,
        ...(specStats ?? {}),
    });

    renderConflicts(conflicts);
    renderUnmapped(unmappedTypes);
    hideProgress();
    _setButtons({ start: true, cancel: false, export: true });
}

// ===== Pass A helpers =====

async function _scanTiles(tileKeys) {
    const locationGroups = new Map();
    const unmappedTypes = new Map();
    let totalSignals = 0, tilesLoaded = 0;

    for (const tileKey of tileKeys) {
        if (_cancelled) break;

        const tile = await fetchTileByKey(tileKey);
        _accumulateUnmapped(tile, unmappedTypes);
        totalSignals += tile.length;

        for (const [key, group] of buildLocationGroups([tile])) {
            if (!locationGroups.has(key)) locationGroups.set(key, group);
            else locationGroups.get(key).feats.push(...group.feats);
        }

        tilesLoaded++;
        _setProgress(tilesLoaded / tileKeys.length,
            `Tile ${tilesLoaded.toLocaleString()} / ${tileKeys.length.toLocaleString()}`
            + ` - ${totalSignals.toLocaleString()} signals`);
    }

    return { locationGroups, unmappedTypes, totalSignals, tilesLoaded };
}

function _accumulateUnmapped(tile, unmappedTypes) {
    for (const raw of tile) {
        const p = normalizeSignal(raw);
        if (SIGNAL_MAPPING[p.signalType]) continue;
        if (!unmappedTypes.has(p.signalType)) {
            unmappedTypes.set(p.signalType, { count: 0, networkIds: new Set() });
        }
        const entry = unmappedTypes.get(p.signalType);
        entry.count++;
        if (p.networkId) entry.networkIds.add(p.networkId);
    }
}

function _deduplicateGroups(locationGroups) {
    let count = 0;
    for (const loc of locationGroups.values()) {
        const seen = new Set();
        loc.feats = loc.feats.filter(feat => {
            const id = feat.p.networkId;
            if (id && seen.has(id)) { count++; return false; }
            if (id) seen.add(id);
            return true;
        });
    }
    return count;
}

function _detectConflicts(locationGroups) {
    const conflicts = [];
    let conflictRows = 0;

    for (const loc of locationGroups.values()) {
        const detected = findConflicts(detectOsmNodes(loc.feats));
        if (!detected.length) continue;
        conflictRows += detected.length;
        conflicts.push({
            key: loc.key,
            trackCode: loc.trackCode,
            milepost: loc.milepost,
            lat: loc.lat,
            lng: loc.lng,
            conflicts: detected.map(dc => ({
                direction: dc.direction,
                placement: dc.placement,
                dupCats: dc.dupCats,
                nodes: dc.nodes.map(node => ({
                    feats: node.feats.map(f => ({
                        p: { signalType: f.p.signalType, networkId: f.p.networkId },
                    })),
                })),
            })),
        });
    }

    return { conflicts, conflictRows };
}

// ===== GeoJSON export =====

/**
 * Export all signals as a standard GeoJSON FeatureCollection.
 *
 * One Feature per OSM node (signals grouped by groupFeats, same algorithm as
 * the main application). Properties are pure OSM key=value tags — no custom
 * or proprietary fields. Compatible with JOSM, QGIS, geojson.io, MapRoulette.
 *
 * Tag building is delegated to osm-tags.js (shared with signal-mapping.js).
 */
function _exportGeoJSON() {
    if (!_lastResults) return;
    const { date, tileScan } = _lastResults;

    const features = [];
    for (const loc of tileScan.locationGroups.values()) {
        // groupFeats (via detectOsmNodes) is the SAME function used by the app.
        const nodeGroups = detectOsmNodes(loc.feats);
        for (const node of nodeGroups) {
            const tags = buildNodeTags(node.feats);
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
                properties: Object.fromEntries(tags),
            });
        }
    }

    const blob = new Blob(
        [JSON.stringify({ type: 'FeatureCollection', features }, null, 2)],
        { type: 'application/geo+json' }
    );

    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const filename = `signals-sncf-osm_${datePart}_${timePart}.geojson`;

    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);

    // The exported node count will be lower than the "Signals" stat because
    // co-located signals sharing an OSM node are merged into one Feature.
    _flashStatus(`Exported ${features.length.toLocaleString()} OSM nodes (${_lastResults.tileScan.signals.toLocaleString()} raw signals)`);
}

// ===== UI helpers =====

function _onCancel(loaded = 0, total = 0) {
    _setProgress(loaded && total ? loaded / total : 0,
        loaded ? `Cancelled after ${loaded.toLocaleString()} / ${total.toLocaleString()} tiles.`
            : 'Cancelled.');
    _setButtons({ start: true, cancel: false, export: false });
}

function _setButtons({ start, cancel, export: exp }) {
    document.getElementById('btn-start').disabled = !start;
    document.getElementById('btn-cancel').disabled = !cancel;
    document.getElementById('btn-export').disabled = !exp;
}

function _setStatus(text) { document.getElementById('status-text').textContent = text; }
function _showProgress(v) { document.getElementById('progress-wrap').classList.toggle('visible', v); }
function _setProgress(fraction, label) {
    document.getElementById('progress-fill').style.width =
        `${(Math.min(fraction, 1) * 100).toFixed(1)}%`;
    document.getElementById('progress-label').textContent = label;
}

/**
 * Show a brief coloured message in #status-text then clear it.
 * validate.html has no full-screen progress overlay (#progress-overlay)
 * so progress.js cannot be used directly here.
 */
function _flashStatus(msg, durationMs = 4000) {
    const el = document.getElementById('status-text');
    if (!el) return;
    el.textContent = msg;
    el.style.color = 'var(--blue)';
    setTimeout(() => { el.textContent = ''; el.style.color = ''; }, durationMs);
}

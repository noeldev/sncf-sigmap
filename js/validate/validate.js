// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * validate.js - Validation orchestrator.
 *
 * Two independent passes launched in parallel:
 *
 *   Pass A - Tile scan (manifest + all tiles):
 *     1. Co-location conflicts  - via conflict-detector.js.
 *     2. Unmapped SNCF types    - codes absent from signal-types.js mapping.
 *
 *   Pass B - Spec diff (wiki fetch only, no tiles):
 *     3. Cross-check all OSM (cat, type) pairs against wiki.
 *        Rendered as soon as the wiki response arrives.
 *
 *   Preset check (automatic, no interaction):
 *     Once the wiki reference is ready, the JOSM presets are loaded from the
 *     configured source and diffed against the wiki.
 *
 * Sources and options come from an optional validate-config.json (next to this
 * module, git-ignored): presetSource and wikiSource may be a local path or URL,
 * and excludedNamespaces lists value namespaces to skip (default ETCS:).
 * The wiki defaults to the live MediaWiki API; presets default to the GitHub raw URL.
 *
 * Export menu:
 *   A single Export button opens a dropdown with two formats. Both reuse one
 *   cached node-generation pass (osm-export.js) so they stay consistent down to
 *   the OSM node count:
 *     - GeoJSON     - a single standard FeatureCollection (immediate download).
 *     - MapRoulette - line-by-line cooperative challenges, one file per leading
 *                     line-code digit, listed in a modal dialog for selective
 *                     download or merge (export-panel.js).
 *   The location grouping is built once during the tile scan and reused; node
 *   generation is built once on first export and cached. Generation and (for
 *   MapRoulette) challenge building report into one monotonic progress range so
 *   the shared bar only ever advances. The export button is disabled for the
 *   whole procedure to prevent re-entrancy. Co-located nodes are offset by
 *   ~50 cm so JOSM can tell them apart.
 */

import { groupFeats } from '../domain/signal-grouping.js';
import { isMapped, applyContextRemaps } from '../domain/signal-types.js';
import { normalizeSignal } from '../domain/sncf-convert.js';
import { loadManifest, fetchTileByKey } from '../core/tiles.js';
import { loadStrings, translateAll, t } from '../core/translation.js';
import { buildCodeSpec, compareSpecs, comparePresetToWiki } from './spec-compare.js';
import { fetchPresetXML } from './preset-parser.js';
import { markOutliers } from './outlier-detector.js';
import {
    generateNodeSets,
    buildFeatureCollection,
    buildMapRouletteChallenges,
} from './osm-export.js';
import { openMapRouletteDialog } from './export-panel.js';
import { triggerDownload, timestampedName } from './download.js';
import { fetchWikiSpec } from './wiki-parser.js';
import {
    buildLocationGroups,
    flagDuplicates,
    findConflicts,
} from './conflict-detector.js';
import {
    APP_URL,
    renderStats, renderConflicts, renderUnmapped,
    renderSpecDiff, renderPresetDiff, revealSection, clearResults
} from './report-renderer.js';

// ===== Config =====

// Optional local config next to the validate modules; absence is not an error.
// Resolved relative to this module so it works regardless of the page path.
const CONFIG_URL = new URL('validate-config.json', import.meta.url);

// Production preset source, used when validate-config.json sets no presetSource.
const DEFAULT_PRESET_URL =
    'https://raw.githubusercontent.com/noeldev/FrenchRailwaySignalling/main/presets/French_Railway_Signalling.xml';

// Fraction of the progress bar used by the node-generation phase when it is
// followed by the MapRoulette build phase. GeoJSON has no second phase.
const GEN_PHASE_FRACTION = 0.5;

// ===== State =====

let _lastResults = null;
let _config = {};

// Guards the whole export procedure (generation + download) against re-entrancy.
let _exporting = false;

// ===== Entry point =====

_init();

async function _init() {
    await _initI18n();
    _config = await _loadConfig();
    _bindEvents();
    _run();
}

/**
 * Load validate-config.json. Absence is fine (returns {}). A present but
 * malformed file (e.g. JSON comments, which are not allowed) is reported on the
 * console instead of failing silently, then defaults are used.
 */
async function _loadConfig() {
    let res;
    try {
        // no-store: a dev edits this file and reloads expecting the new values,
        // so never serve a cached copy.
        res = await fetch(CONFIG_URL, { cache: 'no-store' });
    } catch {
        return {}; // file not reachable: treat as absent
    }
    if (!res.ok) {
        console.info('[validate] no validate-config.json next to validate.js; using defaults.');
        return {}; // absent
    }

    try {
        const cfg = await res.json();
        console.info('[validate] validate-config.json loaded.');
        return cfg;
    } catch (err) {
        console.warn('[validate] validate-config.json is present but not valid JSON; using defaults.', err);
        return {};
    }
}

// ===== Initialisation helpers =====

async function _initI18n() {
    // Detect the browser language and try the matching validate strings file.
    // loadStrings() already falls back to en-US when the requested locale fails.
    const locale = _detectLocale();
    await loadStrings(locale, 'validate');
    translateAll();
}

/**
 * Return the browser locale to use for validate strings.
 * Uses navigator.language directly - no fixed supported-locale list.
 * loadStrings() constructs the filename as validate.{locale.toLowerCase()}.json
 * and falls back to en-US when the file cannot be loaded.
 */
function _detectLocale() {
    return navigator.language ?? 'en-US';
}

function _bindEvents() {
    _bindExportMenu();
}

function _applyLocationContextRemaps(locationGroups) {
    for (const loc of locationGroups.values()) applyContextRemaps(loc.feats);
}

// ===== Run =====

async function _run() {
    _lastResults = null;

    _enableExport(false);
    clearResults();
    _setProgress(0, t('progress.fetching'));

    const [wikiSpec, manifest] = await Promise.all([
        fetchWikiSpec(_config.wikiSource),
        loadManifest(),
    ]);

    // Pass B: spec diff - rendered immediately when wiki arrives.
    const specStats = _runSpecDiff(wikiSpec);

    // Preset cross-check - runs automatically from the configured source.
    // Fire-and-forget so the tile scan is not delayed.
    _runPresetCheck(wikiSpec);

    if (!manifest) {
        _setProgress(0, t('error.manifest'));
        return;
    }

    // Pass A: tile scan.
    const { locationGroups, unmappedTypes, totalSignals, tilesLoaded } =
        await _scanTiles(Object.keys(manifest.tiles));

    _setProgress(1, t('progress.analysing'));

    // Apply context remaps before flagDuplicates so all downstream passes
    // (duplicate detection, conflict detection, export) use the effective types.
    _applyLocationContextRemaps(locationGroups);

    flagDuplicates(locationGroups);
    const { conflicts, conflictRows } = _detectConflicts(locationGroups);

    _lastResults = {
        date: new Date().toISOString(),
        specStats,
        tileScan: {
            tiles: tilesLoaded,
            signals: totalSignals,
            locations: locationGroups.size,
            conflicts,
            conflictRows,
            unmappedTypes,
            locationGroups,
            // Filled lazily on first export, then reused (see _ensureNodeSets).
            nodeSets: null,
        },
    };

    renderStats({
        signals: totalSignals,
        locations: locationGroups.size,
        conflictLocations: conflicts.length,
        unmappedTypes: unmappedTypes.size,
        wikiDiff: specStats ? specStats.onlyInWiki + specStats.onlyInCode : undefined,
    });

    renderConflicts(conflicts);
    renderUnmapped(unmappedTypes);
    _setStatus('');
    _enableExport(true);
}

// ===== Pass B: spec diff =====

function _runSpecDiff(wikiSpec) {
    if (!wikiSpec) {
        _setStatus(t('error.warnWikiFailed'));
        return null;
    }
    // buildCodeSpec() derives its data from signal-types.js internally.
    const diffResult = compareSpecs(wikiSpec, buildCodeSpec(), _config.excludedNamespaces);
    renderSpecDiff(diffResult);
    return {
        wikiPairs: wikiSpec.pairs.length,
        matched: diffResult.matched.length,
        onlyInWiki: diffResult.onlyInWiki.length,
        onlyInCode: diffResult.onlyInCode.length,
    };
}

// ===== Preset cross-check =====

/**
 * Load the JOSM presets from the configured source and diff them against the
 * wiki. Runs automatically; the section shows the result with no interaction.
 */
async function _runPresetCheck(wikiSpec) {
    if (!wikiSpec) return; // no reference to compare against
    revealSection('section-preset');
    _setPresetStatus(t('preset.loading'));
    try {
        const source = _config.presetSource || DEFAULT_PRESET_URL;
        const presetSpec = await fetchPresetXML(source);
        const diff = comparePresetToWiki(wikiSpec, presetSpec, _config.excludedNamespaces);
        renderPresetDiff(diff);
        const onlyWiki = diff.onlyInWiki.length;
        const onlyPreset = diff.onlyInPreset.length;
        _setPresetStatus(t('preset.loaded',
            diff.matched.length, onlyWiki + onlyPreset, onlyWiki, onlyPreset));
    } catch (err) {
        console.error('[preset-check]', err);
        _setPresetStatus(t('preset.error', err.message));
    }
}

function _setPresetStatus(text) {
    const el = document.getElementById('preset-status');
    if (el) el.textContent = text;
}

// ===== Pass A helpers =====

async function _scanTiles(tileKeys) {
    const locationGroups = new Map();
    const unmappedTypes = new Map();
    let totalSignals = 0, tilesLoaded = 0;

    for (const tileKey of tileKeys) {
        let tile;
        try {
            tile = await fetchTileByKey(tileKey);
        } catch (err) {
            console.warn(`Tile ${tileKey} failed:`, err);
            _setStatus(t('error.tileLoad', tileKey));
            tilesLoaded++;
            _setProgress(tilesLoaded / tileKeys.length,
                t('progress.tile', tilesLoaded, tileKeys.length, totalSignals));
            continue;
        }
        _accumulateUnmapped(tile, unmappedTypes);
        totalSignals += tile.length;

        for (const [key, group] of buildLocationGroups([tile])) {
            if (!locationGroups.has(key)) locationGroups.set(key, group);
            else locationGroups.get(key).feats.push(...group.feats);
        }

        tilesLoaded++;
        _setProgress(
            tilesLoaded / tileKeys.length,
            t('progress.tile', tilesLoaded, tileKeys.length, totalSignals)
        );
    }

    return { locationGroups, unmappedTypes, totalSignals, tilesLoaded };
}

function _accumulateUnmapped(tile, unmappedTypes) {
    for (const raw of tile) {
        const p = normalizeSignal(raw);
        if (isMapped(p.signalType)) continue; // delegates to signal-types.js
        if (!unmappedTypes.has(p.signalType)) {
            unmappedTypes.set(p.signalType, { count: 0, networkIds: new Set() });
        }
        const entry = unmappedTypes.get(p.signalType);
        entry.count++;
        if (p.networkId) entry.networkIds.add(p.networkId);
    }
}

// ===== Conflict detection =====

function _detectConflicts(locationGroups) {
    const conflicts = [];
    let conflictRows = 0;

    for (const loc of locationGroups.values()) {
        // Two-pass grouping:
        //   1. Identify outlier feats via isolation-score criterion (outlier-detector.js).
        //   2. Sort feats: originals first, outliers last.
        //   3. groupFeats() on sorted order - each outlier's type is already claimed
        //      by an original in the primary node, so the outlier goes to a secondary node.
        const outliers = markOutliers(loc.feats);
        const sortedFeats = [...loc.feats].sort(
            (a, b) => (outliers.has(a) ? 1 : 0) - (outliers.has(b) ? 1 : 0)
        );

        const { nodeGroups, isMech } = groupFeats(sortedFeats);
        const detected = findConflicts(nodeGroups);
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
                isMech,
                nodes: dc.nodes.map(node => ({
                    feats: node.feats.map(f => ({
                        p: {
                            signalType: f.p.signalType,
                            networkId: f.p.networkId,
                            isDupId: f.p.isDupId ?? false,
                            isDupType: f.p.isDupType ?? false,
                        },
                    })),
                })),
            })),
        });
    }

    return { conflicts, conflictRows };
}

// ===== Export menu =====

function _bindExportMenu() {
    const toggle = document.getElementById('btn-export');
    const menu = document.getElementById('export-menu');
    const dropdown = menu.querySelector('.export-dropdown');

    toggle.addEventListener('click', () => {
        if (toggle.disabled) return;
        _toggleExportMenu(toggle, dropdown);
    });

    // One delegated handler for every item; data-format selects the writer.
    dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.export-item');
        if (!item) return;
        _closeExportMenu(toggle, dropdown);
        _runExport(item.dataset.format);
    });

    // Dismiss the action dropdown on outside click or Escape.
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) _closeExportMenu(toggle, dropdown);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') _closeExportMenu(toggle, dropdown);
    });
}

function _toggleExportMenu(toggle, dropdown) {
    const willOpen = dropdown.hidden;
    dropdown.hidden = !willOpen;
    toggle.setAttribute('aria-expanded', String(willOpen));
}

function _closeExportMenu(toggle, dropdown) {
    dropdown.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
}

/**
 * Run an export format end to end. The export button is disabled for the whole
 * procedure (generation, and for MapRoulette the open dialog) and re-enabled
 * only when it completes, errors, or the dialog is closed - so the button can
 * never be triggered twice concurrently.
 *
 * Progress is monotonic: when generation runs ahead of the MapRoulette build,
 * generation fills [0, GEN_PHASE_FRACTION] and the build fills the remainder;
 * a cached generation lets the build use the whole bar.
 */
async function _runExport(format) {
    if (_exporting || !_lastResults) return;
    _exporting = true;
    _enableExport(false);

    try {
        const scan = _lastResults.tileScan;
        const needGen = !scan.nodeSets;
        const genSpan = (format === 'maproulette' && needGen) ? GEN_PHASE_FRACTION : 1;

        if (needGen) {
            _setProgress(0, t('export.generating'));
            scan.nodeSets = await generateNodeSets(scan.locationGroups, {
                onProgress: f => _setProgress(f * genSpan, t('export.generating')),
            });
        }

        if (format === 'geojson') {
            _exportGeoJSON(scan.nodeSets);
            _endExport();
        } else if (format === 'maproulette') {
            await _exportMapRoulette(scan.nodeSets, needGen ? genSpan : 0);
        } else {
            _endExport();
        }
    } catch (err) {
        console.error('[export]', err);
        _setStatus(t('export.error', err.message));
        _endExport();
    }
}

/** Release the export guard and re-enable the button. */
function _endExport() {
    _exporting = false;
    _enableExport(true);
}

// ===== Export writers =====

/**
 * Export all signals as a single standard GeoJSON FeatureCollection.
 *
 * Properties are pure OSM key=value tags. Compatible with JOSM, QGIS,
 * geojson.io, and MapRoulette (classic challenges).
 */
function _exportGeoJSON(nodeSets) {
    const fc = buildFeatureCollection(nodeSets, { appUrl: APP_URL });
    triggerDownload(
        JSON.stringify(fc, null, 2),
        timestampedName('signals-sncf-osm', 'geojson'),
        'application/geo+json'
    );
    _setProgress(1, t('export.done', fc.features.length, _lastResults.tileScan.signals));
}

/**
 * Export all signals as MapRoulette cooperative challenges: one file per leading
 * line-code digit. The files are listed in a modal for selective download (or
 * merge). Their total OSM node count matches the GeoJSON export exactly.
 *
 * @param {Array} nodeSets
 * @param {number} base  Progress fraction already consumed by generation.
 */
async function _exportMapRoulette(nodeSets, base) {
    const span = 1 - base;

    const files = await buildMapRouletteChallenges(nodeSets, {
        onProgress: f => _setProgress(base + f * span, t('export.generating')),
    });

    // The regional files partition every signal, so their sum is the grand total.
    const tasks = files.reduce((sum, f) => sum + f.taskCount, 0);
    const nodes = files.reduce((sum, f) => sum + f.nodeCount, 0);
    _setProgress(1, t('export.mrReady', files.length, tasks, nodes));

    // The dialog owns re-enabling the export button via onClose.
    openMapRouletteDialog(files, { onClose: _endExport });
}

// ===== UI helpers =====

function _enableExport(enable) {
    document.getElementById('btn-export').disabled = !enable;
}

function _setStatus(text) {
    document.getElementById('status-text').textContent = text;
}

function _setProgress(fraction, msg) {
    document.getElementById('progress-fill').style.width =
        `${(Math.min(fraction, 1) * 100).toFixed(1)}%`;
    _setStatus(msg);
}

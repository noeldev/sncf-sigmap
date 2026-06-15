// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * validate-main.js - Validation orchestrator.
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
 * excludedNamespaces lists value namespaces to skip (default ETCS:),
 * maprouletteGroupDigits sets the line-code prefix length used to split the
 * MapRoulette files (default 1). The wiki defaults to the live MediaWiki API;
 * the presets default to the GitHub raw URL.
 *
 * Export menu:
 *   A single Export button opens a dropdown with two formats. Both reuse the
 *   same node generation (osm-export.js) so they stay consistent, OSM node count
 *   included:
 *     - GeoJSON     - a single standard FeatureCollection (immediate download).
 *     - MapRoulette - line-by-line cooperative challenges, split into one file
 *                     per line-code bucket and listed in a popover so each can
 *                     be downloaded on its own or all at once (export-panel.js).
 *   Co-located nodes are offset by ~50 cm so JOSM can distinguish them.
 */

import { groupFeats } from '../signal-grouping.js';
import { isMapped } from '../signal-types.js';
import { normalizeSignal } from '../sncf-convert.js';
import { loadManifest, fetchTileByKey } from '../tiles.js';
import { loadStrings, translateAll, t } from '../translation.js';
import { buildCodeSpec, compareSpecs, comparePresetToWiki } from './spec-compare.js';
import { fetchPresetXML } from './preset-parser.js';
import { markOutliers } from './outlier-detector.js';
import { buildFeatureCollection, buildMapRouletteChallenges } from './osm-export.js';
import { showMapRouletteFiles, hideMapRouletteFiles } from './export-panel.js';
import { triggerDownload, timestampedName } from './download.js';
import { fetchWikiSpec } from './wiki-parser.js';
import {
    buildLocationGroups,
    flagDuplicates,
    findConflicts
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

// ===== State =====

let _lastResults = null;
let _config = {};

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
        res = await fetch(CONFIG_URL);
    } catch {
        return {}; // file not reachable: treat as absent
    }
    if (!res.ok) return {}; // absent

    try {
        return await res.json();
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
 * Uses navigator.language directly — no fixed supported-locale list.
 * loadStrings() constructs the filename as validate.{locale.toLowerCase()}.json
 * and falls back to en-US when the file cannot be loaded.
 */
function _detectLocale() {
    return navigator.language ?? 'en-US';
}

function _bindEvents() {
    _bindExportMenu();
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

    // Pass B: spec diff — rendered immediately when wiki arrives.
    const specStats = _runSpecDiff(wikiSpec);

    // Preset cross-check — runs automatically from the configured source.
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
        //   3. groupFeats() on sorted order — each outlier's type is already claimed
        //      by an original in the primary node, so the outlier goes to a secondary node.
        markOutliers(loc.feats);
        const sortedFeats = [...loc.feats].sort(
            (a, b) => (a.p._outlier ? 1 : 0) - (b.p._outlier ? 1 : 0)
        );
        for (const f of loc.feats) delete f.p._outlier;

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

function _runExport(format) {
    // The MapRoulette popover is only relevant to that format; close it for any
    // other action so it does not linger behind a GeoJSON download.
    if (format !== 'maproulette') hideMapRouletteFiles();

    if (format === 'geojson') _exportGeoJSON();
    else if (format === 'maproulette') _exportMapRoulette();
}

// ===== Export writers =====

/**
 * Export all signals as a single standard GeoJSON FeatureCollection.
 *
 * Properties are pure OSM key=value tags. Compatible with JOSM, QGIS,
 * geojson.io, and MapRoulette (classic challenges).
 */
function _exportGeoJSON() {
    if (!_lastResults) return;
    const { tileScan } = _lastResults;

    const fc = buildFeatureCollection(tileScan.locationGroups, { appUrl: APP_URL });
    triggerDownload(
        JSON.stringify(fc, null, 2),
        timestampedName('signals-sncf-osm', 'geojson'),
        'application/geo+json'
    );

    _setStatus(t('export.done', fc.features.length, tileScan.signals));
}

/**
 * Export all signals as MapRoulette cooperative challenges, split by line code.
 * The files are listed in the popover for individual or bulk download. The total
 * OSM node count across all files matches the GeoJSON export exactly.
 */
function _exportMapRoulette() {
    if (!_lastResults) return;
    const { tileScan } = _lastResults;

    const files = buildMapRouletteChallenges(tileScan.locationGroups, {
        groupDigits: _config.maprouletteGroupDigits,
    });
    showMapRouletteFiles(files);

    const tasks = files.reduce((sum, f) => sum + f.taskCount, 0);
    const nodes = files.reduce((sum, f) => sum + f.nodeCount, 0);
    _setStatus(t('export.mrReady', files.length, tasks, nodes));
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

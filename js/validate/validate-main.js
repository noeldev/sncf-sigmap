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
 * excludedNamespaces lists value namespaces to skip (default ETCS:). The wiki
 * defaults to the live MediaWiki API; the presets default to the GitHub raw URL.
 *
 * GeoJSON export:
 *   Exports ALL signals as a FeatureCollection for OSM integration.
 *   Co-located nodes are offset by ~50 cm so JOSM can distinguish them.
 */

import { NODE_OFFSET_DEG } from '../config.js';
import { buildNodeTags } from '../osm-tags.js';
import { groupFeats } from '../signal-grouping.js';
import { isMapped } from '../signal-types.js';
import { normalizeSignal } from '../sncf-convert.js';
import { loadManifest, fetchTileByKey } from '../tiles.js';
import { loadStrings, translateAll, t } from '../translation.js';
import { buildCodeSpec, compareSpecs, comparePresetToWiki } from './spec-compare.js';
import { fetchPresetXML } from './preset-parser.js';
import { markOutliers } from './outlier-detector.js';
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
    const btn = document.getElementById('btn-export');
    btn.addEventListener('click', _exportGeoJSON);
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

// ===== GeoJSON export =====

const RE_CLEANUP = /[-:]/g;

function _getExportFilename() {
    const now = new Date();
    const iso = now.toISOString(); // Ex: "2026-06-02T14:30:15.123Z"
    const timestamp = iso.slice(0, 19).replace('T', '_').replace(RE_CLEANUP, '');
    return `signals-sncf-osm_${timestamp}Z.geojson`;
}

/**
 * Export all signals as a standard GeoJSON FeatureCollection.
 *
 * Co-located signals at the same location produce multiple OSM nodes.
 * Each node is offset by ~50 cm along the longitude axis so that JOSM
 * and other editors can distinguish them visually and edit each one
 * independently.
 *
 * Properties are pure OSM key=value tags. Compatible with JOSM, QGIS,
 * geojson.io, and MapRoulette.
 */

function _exportGeoJSON() {
    if (!_lastResults) return;
    const { tileScan } = _lastResults;

    const features = [];
    for (const loc of tileScan.locationGroups.values()) {
        const { nodeGroups, isMech } = groupFeats(loc.feats);
        for (let i = 0; i < nodeGroups.length; i++) {
            const tags = buildNodeTags(nodeGroups[i].feats, { isMech });
            // Offset each node on the latitude axis so co-located nodes are
            // individually selectable in JOSM. Same constant as signal-popup.js.
            const lat = loc.lat + i * NODE_OFFSET_DEG;
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [loc.lng, lat] },
                properties: Object.fromEntries(tags),
            });
        }
    }

    const blob = new Blob(
        [JSON.stringify({
            type: 'FeatureCollection',
            name: 'SNCF Signalisation Permanente — OSM export',
            description: `Generated by ${APP_URL}/validate.html`,
            features,
        }, null, 2)],
        { type: 'application/geo+json' }
    );

    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: _getExportFilename(),
    });
    a.click();
    URL.revokeObjectURL(a.href);

    _setStatus(t('export.done', features.length, tileScan.signals));
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
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * osm-export.js - Build OSM export payloads from location groups.
 *
 * Single source of node generation shared by both export formats, so the two
 * stay strictly consistent (same node splitting, same co-location offset, same
 * tags, and the SAME total node count). The DOM side (menu, dialog, download)
 * lives in validate.js / export-panel.js.
 *
 * Generate once, format twice:
 *   generateNodeSets() runs the heavy pass exactly once (groupFeats +
 *   buildNodeTags per location, co-location offset applied). validate.js caches
 *   the result, so exporting GeoJSON then MapRoulette - or re-exporting - never
 *   rebuilds the nodes. buildFeatureCollection() and buildMapRouletteChallenges()
 *   are formatters over that cached structure.
 *
 * Two formats, one node source:
 *   buildFeatureCollection()     - standard GeoJSON FeatureCollection (all nodes
 *                                  flattened into one features array).
 *   buildMapRouletteChallenges() - line-by-line GeoJSON (NDJSON), one file per
 *                                  leading line-code digit (0..9) for
 *                                  region-by-region challenges. Each task
 *                                  is a standalone FeatureCollection carrying a
 *                                  cooperativeWork .osc so JOSM can pre-create the
 *                                  node(s); all nodes of a location stay in the
 *                                  same task. Every location lands in exactly one
 *                                  file, so the union of all files reproduces the
 *                                  GeoJSON node set node-for-node.
 *
 * Bucketing and regions:
 *   Locations are grouped by the leading digit of their SNCF line code
 *   (code_ligne, exposed as p.lineCode), giving ten regional files; every signal
 *   in the open data carries a 6-digit code, so all are covered. Each file
 *   carries a coarse, informal French region label (REGION_LABEL) shown as-is
 *   (never translated, not an official name).
 *
 * XML:
 *   The .osc document is built with the DOM (createElement / XMLSerializer),
 *   not assembled from strings, so attribute values are escaped by the
 *   serializer and no XML markup lives in this file.
 *
 * Async:
 *   The heavy loops await a macrotask every BATCH_SIZE items so the shared
 *   progress bar updates and the page stays responsive on the full dataset.
 *
 * MapRoulette cooperative format reference:
 *   https://github.com/osmlab/maproulette3/wiki/Cooperative-Challenges
 *   meta.version = 2, meta.type = 2 (change file), file.format = osc, base64.
 *
 * Public API:
 *   generateNodeSets(locationGroups, opts)     -> Promise<Array<NodeSet>>
 *   buildFeatureCollection(nodeSets, opts)     -> object   (GeoJSON)
 *   buildMapRouletteChallenges(nodeSets, opts) -> Promise<Array<ChallengeFile>>
 *
 *   NodeSet       = { lineCode: string, nodes: Array<{ lat, lng, tags }> }
 *   ChallengeFile = { bucket, region, taskCount, nodeCount, content }
 */

import { APP_ID, NODE_OFFSET_DEG } from '../core/config.js';
import { buildNodeTags } from '../domain/osm-tags.js';
import { groupFeats } from '../domain/signal-grouping.js';

// ===== Constants =====

// Name embedded in the standard GeoJSON FeatureCollection (output string, not a comment).
const COLLECTION_NAME = 'SNCF Signalisation Permanente - OSM export';

// generator attribute written on the osmChange document.
const OSC_GENERATOR = APP_ID;

// XML prolog (XMLSerializer does not emit one).
const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

// MapRoulette cooperative metadata - only this exact combination is supported.
const MR_META = { version: 2, type: 2 };

// SNCF RFN line codes are 6 digits; shorter codes have leading zeros stripped.
const LINE_CODE_WIDTH = 6;

// Coarse SNCF operating region by leading line-code digit. These informal
// groupings are shown as-is (a single French label, never translated) since
// they are an approximation, not officially established names.
const REGION_LABEL = {
    0: 'Est / Nord-Est', 1: 'Est / Nord-Est',
    2: 'Nord',
    3: 'Ouest', 4: 'Ouest',
    5: 'Sud-Ouest', 6: 'Sud-Ouest',
    7: 'Sud-Est', 8: 'Sud-Est', 9: 'Sud-Est',
};

// Items processed between cooperative yields to the event loop.
const BATCH_SIZE = 2000;

// ===== Public API =====

/**
 * Run the single heavy generation pass over every location group.
 *
 * @param {Map<string, object>} locationGroups
 * @param {{ onProgress?: (f:number)=>void, batchSize?: number }} [opts]
 * @returns {Promise<Array<{ lineCode: string, nodes: Array<object> }>>}
 */
export async function generateNodeSets(locationGroups, { onProgress, batchSize = BATCH_SIZE } = {}) {
    const sets = [];
    const total = locationGroups.size || 1;
    let i = 0;

    for (const loc of locationGroups.values()) {
        const { nodeGroups, isMech } = groupFeats(loc.feats);
        const nodes = nodeGroups.map((ng, idx) => ({
            lat: loc.lat + idx * NODE_OFFSET_DEG,
            lng: loc.lng,
            tags: buildNodeTags(ng.feats, { isMech }),
        }));
        sets.push({ lineCode: _lineCodeOf(loc), nodes });

        if (++i % batchSize === 0) {
            onProgress?.(i / total);
            await _yield();
        }
    }
    onProgress?.(1);
    return sets;
}

/**
 * Build a standard GeoJSON FeatureCollection from the generated node sets.
 *
 * @param {Array<{ nodes: Array<object> }>} nodeSets
 * @param {{ appUrl?: string }} [opts]  appUrl is used in the description field.
 * @returns {object}  GeoJSON FeatureCollection.
 */
export function buildFeatureCollection(nodeSets, { appUrl } = {}) {
    const features = [];
    for (const set of nodeSets) {
        for (const node of set.nodes) features.push(_toFeature(node));
    }

    const fc = { type: 'FeatureCollection', name: COLLECTION_NAME, features };
    if (appUrl) fc.description = `Generated by ${appUrl}/validate.html`;
    return fc;
}

/**
 * Build MapRoulette cooperative challenge files from the generated node sets:
 * one file per leading line-code digit (0..9). Every signal in the SNCF open
 * data carries a 6-digit line code, so these ten buckets cover them all.
 *
 * @param {Array<{ lineCode: string, nodes: Array<object> }>} nodeSets
 * @param {{ onProgress?: (f:number)=>void, batchSize?: number }} [opts]
 * @returns {Promise<Array<{
 *   bucket: string, region: string,
 *   taskCount: number, nodeCount: number, content: string
 * }>>}
 */
export async function buildMapRouletteChallenges(nodeSets, { onProgress, batchSize = BATCH_SIZE } = {}) {
    const buckets = new Map();      // bucket key -> { lines, nodeCount }
    const total = nodeSets.length || 1;
    let done = 0;

    for (const set of nodeSets) {
        const key = _bucketKey(set.lineCode);
        if (!buckets.has(key)) buckets.set(key, { lines: [], nodeCount: 0 });

        const bucket = buckets.get(key);
        bucket.lines.push(_buildTask(set.nodes));
        bucket.nodeCount += set.nodes.length;

        if (++done % batchSize === 0) {
            onProgress?.(done / total);
            await _yield();
        }
    }
    onProgress?.(1);

    const files = [];
    for (const [key, bucket] of buckets) {
        files.push({
            bucket: _bucketLabel(key),
            region: _region(key),
            taskCount: bucket.lines.length,
            nodeCount: bucket.nodeCount,
            content: bucket.lines.join('\n'),
        });
    }
    // Stable order: "0xxxxx".."9xxxxx".
    files.sort((a, b) => a.bucket.localeCompare(b.bucket));
    return files;
}

// ===== Node helpers =====

/** Line code of a location, taken from its first feat (all share the same one). */
function _lineCodeOf(loc) {
    return loc.feats[0]?.p.lineCode ?? '';
}

/** Convert one node into a GeoJSON Point Feature with OSM key=value properties. */
function _toFeature(node) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [node.lng, node.lat] },
        properties: Object.fromEntries(node.tags),
    };
}

// ===== Bucketing / regions =====

/** Bucket key: the leading digit of the zero-padded line code ("0".."9"). */
function _bucketKey(lineCode) {
    const digits = String(lineCode ?? '').replace(/\D/g, '');
    return digits.padStart(LINE_CODE_WIDTH, '0')[0];
}

/** Human-readable bucket label, e.g. "7" -> "7xxxxx". */
function _bucketLabel(bucket) {
    return bucket + 'x'.repeat(LINE_CODE_WIDTH - 1);
}

/** Informal region label for a leading-digit bucket. */
function _region(bucket) {
    return REGION_LABEL[Number(bucket)] ?? '';
}

// ===== MapRoulette task building =====

/**
 * Build one line-by-line GeoJSON task: a standalone FeatureCollection plus a
 * cooperativeWork section carrying the base64-encoded .osc for its node(s).
 *
 * @param {Array<{ lat, lng, tags }>} nodes  All nodes at one location.
 * @returns {string}  A single JSON line (no trailing newline).
 */
function _buildTask(nodes) {
    const task = {
        type: 'FeatureCollection',
        features: nodes.map(_toFeature),
        cooperativeWork: {
            meta: MR_META,
            file: {
                type: 'xml',
                format: 'osc',
                encoding: 'base64',
                content: _utf8ToBase64(_buildOsc(nodes)),
            },
        },
    };
    return JSON.stringify(task);
}

/**
 * Build an OSM Change document that creates every node of a location, using the
 * DOM so attribute values are escaped by the serializer. Negative ids
 * (-1, -2, ...) mark the nodes as new elements for JOSM.
 *
 * @param {Array<{ lat, lng, tags }>} nodes
 * @returns {string}  .osc XML.
 */
function _buildOsc(nodes) {
    const doc = document.implementation.createDocument(null, 'osmChange', null);
    const root = doc.documentElement;
    root.setAttribute('version', '0.6');
    root.setAttribute('generator', OSC_GENERATOR);

    const create = doc.createElement('create');
    nodes.forEach((node, i) => {
        const el = doc.createElement('node');
        el.setAttribute('id', String(-(i + 1)));
        el.setAttribute('lat', String(node.lat));
        el.setAttribute('lon', String(node.lng));
        el.setAttribute('version', '0');
        el.setAttribute('changeset', '0');
        for (const [k, v] of node.tags) {
            const tag = doc.createElement('tag');
            tag.setAttribute('k', k);
            tag.setAttribute('v', v);
            el.appendChild(tag);
        }
        create.appendChild(el);
    });
    root.appendChild(create);

    return XML_DECL + new XMLSerializer().serializeToString(doc);
}

// ===== Encoding helpers =====

/**
 * Base64-encode a UTF-8 string. btoa() is Latin1-only, so the string is first
 * encoded to bytes; per-task .osc payloads are small enough for fromCharCode.
 *
 * @param {string} str
 * @returns {string}  Base64.
 */
function _utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

/** Yield a macrotask so the UI (progress bar) can repaint between batches. */
function _yield() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

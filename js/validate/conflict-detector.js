/**
 * conflict-detector.js — Co-location OSM node conflict detection.
 *
 * Replicates the grouping logic from signal-mapping.js (getOsmNodes / _canFit)
 * and the location key logic from tiles-worker.js (_groupKey) without the
 * tag-building step and without the translation.js dependency chain.
 *
 * A conflict occurs when two signals at the same location share the same
 * direction AND the same OSM category (cat), forcing getOsmNodes() to split
 * them onto separate OSM nodes. At the same location+direction, a cat may
 * only appear once per node.
 *
 * Public API:
 *   buildLocationGroups(tiles, manifest) → Map<key, LocationGroup>
 *   detectOsmNodes(feats)                → OsmNodeGroup[]
 *   findDirectionConflicts(nodes)        → DirectionConflict[]
 *
 * Types:
 *   LocationGroup    = { lat, lng, key, feats[] }
 *   OsmNodeGroup     = { direction, feats[], categories: Set<string> }
 *   DirectionConflict = { direction, nodes: OsmNodeGroup[], dupCats: string[] }
 */

import { SIGNAL_MAPPING }  from '../signal-types.js';
import { normalizeSignal } from '../sncf-convert.js';

// Priority table — mirrors TYPE_PRIORITY in signal-mapping.js exactly.
// Must stay in sync when signal-types.js entries are reordered.
const TYPE_PRIORITY = Object.freeze(
    Object.fromEntries(Object.keys(SIGNAL_MAPPING).map((type, i) => [type, i]))
);
const UNSUPPORTED_PRIORITY = Infinity;

function _typePriority(type) {
    return TYPE_PRIORITY[type] ?? UNSUPPORTED_PRIORITY;
}

// ===== Public API =====

/**
 * Build location groups from an array of raw tile signal arrays.
 * Mirrors the _groupByLocation() logic in tiles-worker.js.
 *
 * @param {object[][]} tiles  Array of raw tile signal arrays (output of fetchTile).
 * @returns {Map<string, LocationGroup>}
 */
export function buildLocationGroups(tiles) {
    const byKey = new Map();

    for (const tile of tiles) {
        if (!Array.isArray(tile)) continue;

        for (const raw of tile) {
            const p   = normalizeSignal(raw);
            const key = _groupKey(p, raw);

            if (!byKey.has(key)) {
                byKey.set(key, { lat: raw.lat, lng: raw.lng, key, feats: [] });
            }
            byKey.get(key).feats.push({ lat: raw.lat, lng: raw.lng, p });
        }
    }

    return byKey;
}

/**
 * Reproduce the getOsmNodes() grouping pass for conflict analysis only.
 * No tag building — returns node group descriptors.
 * Exact mirror of getOsmNodes() sort + _canFit() in signal-mapping.js.
 *
 * @param {Array<{ lat: number, lng: number, p: object }>} feats
 * @returns {OsmNodeGroup[]}
 */
export function detectOsmNodes(feats) {
    // Sort mirrors getOsmNodes(): cluster by first-4 networkId digits, then type priority.
    const sorted = [...feats].sort((a, b) => {
        const clA = (a.p.networkId ?? '').slice(0, 4);
        const clB = (b.p.networkId ?? '').slice(0, 4);
        if (clA !== clB) return clA < clB ? -1 : 1;
        return _typePriority(a.p.signalType) - _typePriority(b.p.signalType);
    });

    const nodes = [];

    for (const feat of sorted) {
        let idx = nodes.findIndex(g => _canFit(feat, g));
        if (idx === -1) {
            const mapping = SIGNAL_MAPPING[feat.p.signalType];
            nodes.push({
                direction:  feat.p.direction,
                feats:      [feat],
                categories: mapping ? new Set([mapping.cat]) : new Set(),
            });
        } else {
            const node = nodes[idx];
            node.feats.push(feat);
            const mapping = SIGNAL_MAPPING[feat.p.signalType];
            if (mapping) node.categories.add(mapping.cat);
        }
    }

    return nodes;
}

/**
 * Find directions that produced more than one OSM node at the same location.
 * A direction conflict means the same direction has two nodes — which implies
 * at least one OSM category appeared twice in that direction.
 *
 * @param {OsmNodeGroup[]} nodes
 * @returns {DirectionConflict[]}
 */
export function findDirectionConflicts(nodes) {
    const byDir = new Map();
    for (const node of nodes) {
        if (!byDir.has(node.direction)) byDir.set(node.direction, []);
        byDir.get(node.direction).push(node);
    }

    const conflicts = [];
    for (const [direction, dirNodes] of byDir) {
        if (dirNodes.length < 2) continue;

        // Find which categories appear on more than one node for this direction.
        const catCounts = new Map();
        for (const node of dirNodes) {
            for (const cat of node.categories) {
                catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
            }
        }
        const dupCats = [...catCounts.entries()]
            .filter(([, n]) => n > 1)
            .map(([cat]) => cat);

        conflicts.push({ direction, nodes: dirNodes, dupCats });
    }

    return conflicts;
}

// ===== Private helpers =====

/**
 * Derive the location group key for a signal.
 * Exact mirror of _groupKey() in tiles-worker.js — must stay in sync.
 *
 * @param {object} p    Normalized signal properties.
 * @param {object} raw  Raw signal from tile JSON (has .lat / .lng).
 * @returns {string}
 */
function _groupKey(p, raw) {
    return (p.trackCode && p.milepost)
        ? `${p.trackCode}|${p.milepost}`
        : `${raw.lat.toFixed(6)},${raw.lng.toFixed(6)}`;
}

/**
 * Returns true when feat can be merged into group without a category conflict.
 * Exact mirror of _canFit() in signal-mapping.js — must stay in sync.
 *
 * @param {{ p: object }}                          feat
 * @param {{ direction: string, categories: Set }} group
 * @returns {boolean}
 */
function _canFit(feat, group) {
    const mapping = SIGNAL_MAPPING[feat.p.signalType];
    if (group.direction !== feat.p.direction) return false;
    if (!mapping) return true;
    return !group.categories.has(mapping.cat);
}

/**
 * conflict-detector.js - Co-location OSM node conflict detection.
 *
 * Analyses location groups produced by buildLocationGroups() and reports
 * locations where getOsmNodes() is forced to create more than one OSM node
 * for the same direction+placement combination (duplicated OSM category).
 *
 * Location group key: trackCode|milepost
 *   All three SNCF identifiers are used so that signals referenced by
 *   different lines at the same PK are kept in separate groups. This matches
 *   the data semantics: the same physical signal can appear once per line in
 *   the SNCF dataset (bifurcation points, shared infrastructure).
 *   sens (direction) and position (placement) are handled by canFit() inside
 *   groupFeats() - they determine node splitting, not location grouping.
 *   nom_voie is excluded: it is always the trailing segment of code_voie and
 *   carries no additional identity information.
 *
 *   Note: this groupKey intentionally diverges from tiles-worker.js _groupKey
 *   (trackCode|milepost only) because the two have different goals:
 *     - tiles-worker.js: physical co-location for map rendering
 *     - conflict-detector.js: data identity for OSM tagging analysis
 *
 * Grouping logic is fully delegated to signal-grouping.js (no mirrored rules).
 *
 * Public API:
 *   buildLocationGroups(tiles) -> Map<key, LocationGroup>
 *   detectOsmNodes(feats)      -> NodeGroup[]   (re-exported from signal-grouping)
 *   findConflicts(nodes)       -> Conflict[]
 *
 * Types:
 *   LocationGroup = { lat, lng, key, trackCode, milepost, feats[] }
 *   NodeGroup     = { direction, placement, feats[], categories: Set, types: Set }
 *   Conflict      = { direction, placement, nodes: NodeGroup[], dupCats: string[] }
 */

import { normalizeSignal } from '../sncf-convert.js';
import { groupFeats as detectOsmNodes } from '../signal-grouping.js';

export { detectOsmNodes };

// ===== Public API =====

/**
 * Build location groups from an array of raw tile signal arrays.
 *
 * @param {object[][]} tiles
 * @returns {Map<string, LocationGroup>}
 */
export function buildLocationGroups(tiles) {
    const byKey = new Map();

    for (const tile of tiles) {
        if (!Array.isArray(tile)) continue;
        for (const raw of tile) {
            const p = normalizeSignal(raw);
            const key = _groupKey(p, raw);

            if (!byKey.has(key)) {
                byKey.set(key, {
                    lat: raw.lat,
                    lng: raw.lng,
                    key,
                    trackCode: p.trackCode,
                    milepost: p.milepost,
                    feats: [],
                });
            }
            byKey.get(key).feats.push({ lat: raw.lat, lng: raw.lng, p });
        }
    }

    return byKey;
}

/**
 * Find NodeGroups where the same direction+placement produced more than one
 * node, implying a duplicated OSM category.
 *
 * @param {NodeGroup[]} nodes
 * @returns {Conflict[]}
 */
export function findConflicts(nodes) {
    const byKey = new Map();
    for (const node of nodes) {
        const k = `${node.direction}|${node.placement}`;
        if (!byKey.has(k)) {
            byKey.set(k, { direction: node.direction, placement: node.placement, nodes: [] });
        }
        byKey.get(k).nodes.push(node);
    }

    const conflicts = [];
    for (const { direction, placement, nodes: grpNodes } of byKey.values()) {
        if (grpNodes.length < 2) continue;

        const catCounts = new Map();
        for (const node of grpNodes) {
            for (const cat of node.categories) {
                catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
            }
        }
        const dupCats = [...catCounts.entries()]
            .filter(([, n]) => n > 1)
            .map(([cat]) => cat);

        conflicts.push({ direction, placement, nodes: grpNodes, dupCats });
    }

    return conflicts;
}

// ===== Private helpers =====

/**
 * Derive the location group key using all three SNCF identity fields.
 * Falls back to lat/lng when any identifier is missing.
 *
 * @param {object} p    Normalized signal properties.
 * @param {object} raw  Raw tile signal (has .lat / .lng).
 * @returns {string}
 */
function _groupKey(p, raw) {
    return (p.trackCode && p.milepost)
        ? `${p.trackCode}|${p.milepost}`
        : `${raw.lat.toFixed(6)},${raw.lng.toFixed(6)}`;
}

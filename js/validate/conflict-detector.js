/**
 * conflict-detector.js — Co-location OSM node conflict detection.
 *
 * Analyses location groups produced by buildLocationGroups() and reports
 * any locations where getOsmNodes() is forced to create more than one OSM
 * node for the same direction+placement combination, meaning at least one
 * OSM category appears twice at that location and direction.
 *
 * Grouping logic is fully delegated to signal-grouping.js so there is no
 * duplication of rules between this module and signal-mapping.js.
 *
 * Public API:
 *   buildLocationGroups(tiles) → Map<key, LocationGroup>
 *   detectOsmNodes(feats)      → NodeGroup[]   (re-exported from signal-grouping)
 *   findConflicts(nodes)       → Conflict[]
 *
 * Types:
 *   LocationGroup = { lat, lng, key, trackCode, trackName, milepost, feats[] }
 *   NodeGroup     = { direction, placement, feats[], categories: Set<string> }
 *   Conflict      = { direction, placement, nodes: NodeGroup[], dupCats: string[] }
 */

import { normalizeSignal } from '../sncf-convert.js';
import { groupFeats as detectOsmNodes } from '../signal-grouping.js';

// Re-export so callers only need one import for both grouping and conflict detection.
export { detectOsmNodes };

// ===== Public API =====

/**
 * Build location groups from an array of raw tile signal arrays.
 * Mirrors _groupByLocation() in tiles-worker.js.
 *
 * Stores trackCode, trackName and milepost on the group so the renderer
 * can display them without re-scanning the feats array.
 *
 * @param {object[][]} tiles  Array of raw tile signal arrays.
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
                    trackName: p.trackName,
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
 * Find NodeGroups where the same direction+placement combination produced
 * more than one node, implying a duplicated OSM category at that location.
 *
 * @param {NodeGroup[]} nodes  Output of detectOsmNodes() (i.e. groupFeats()).
 * @returns {Conflict[]}
 */
export function findConflicts(nodes) {
    // Bucket nodes by their direction+placement key.
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

        // Identify which categories appear on more than one node.
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
 * Derive the location group key for a signal.
 * Exact mirror of _groupKey() in tiles-worker.js — must stay in sync.
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

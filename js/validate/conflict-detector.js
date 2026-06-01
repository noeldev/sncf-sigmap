/**
 * conflict-detector.js - Co-location OSM node conflict detection.
 *
 * Analyses location groups produced by buildLocationGroups() and reports
 * locations where getOsmNodes() is forced to create more than one OSM node
 * for the same direction+placement combination (duplicated OSM category).
 *
 * Location group key: trackCode|milepost
 *   trackCode already embeds the line identifier (code_ligne), so lineCode
 *   does not appear separately. This ensures that signals referenced by
 *   different lines at the same PK are kept in separate groups, matching
 *   the data semantics: the same physical signal can appear once per line
 *   in the SNCF dataset (bifurcation points, shared infrastructure).
 *   sens (direction) and position (placement) are handled by canFit() inside
 *   groupFeats() — they determine node splitting, not location grouping.
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
 * Duplicate detection:
 *   isDupId   — same (networkId + signalType) in the same location group.
 *               Flags data entry errors where the same physical signal was
 *               imported twice under the same identifier.
 *   isDupType — same signalType appears in two or more nodeGroups at the same
 *               direction+placement, and that type does not have allowMultiple
 *               in signal-types.js. Flags data redundancy (e.g. two TIV-D).
 *               Types with allowMultiple: true (TLD, DESTI, ...) are exempt.
 *
 * Both flags are set directly on feat.p before the conflict data leaves this
 * module, so the renderer reads them as plain properties — no DOM scanning.
 *
 * Public API:
 *   buildLocationGroups(tiles) -> Map<key, LocationGroup>
 *   flagDuplicates(locationGroups) -> void  (mutates feat.p in place)
 *   findConflicts(nodes)       -> Conflict[]
 *
 * Types:
 *   LocationGroup = { lat, lng, key, trackCode, milepost, feats[] }
 *   NodeGroup     = { direction, placement, feats[], categories: Set, types: Set }
 *   Conflict      = { direction, placement, nodes: NodeGroup[], dupCats: string[] }
 */

import { normalizeSignal } from '../sncf-convert.js';
import { getMappingEntry } from '../signal-types.js';

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
 * Flag duplicate signals within each location group.
 *
 * isDupId: set on feats sharing the same (signalType + networkId) in the same
 * location. Indicates a data entry error — same physical signal imported twice.
 *
 * Must be called after all tiles are accumulated into locationGroups, before
 * groupFeats() and findConflicts(), so the flags travel with the feat objects.
 *
 * @param {Map<string, LocationGroup>} locationGroups
 */
export function flagDuplicates(locationGroups) {
    for (const loc of locationGroups.values()) {
        // Count (signalType, networkId) pairs within this location.
        const counts = new Map();
        for (const feat of loc.feats) {
            const nid = feat.p.networkId;
            if (!nid) continue;
            const key = feat.p.signalType + '\x00' + nid;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        // Flag feats that appear more than once.
        for (const feat of loc.feats) {
            const nid = feat.p.networkId;
            feat.p.isDupId = !!nid && (counts.get(feat.p.signalType + '\x00' + nid) ?? 0) > 1;
        }
    }
}

/**
 * Find NodeGroups where the same direction+placement produced more than one
 * node, implying a duplicated OSM category. Also flags isDupType on feats
 * whose signalType appears in more than one node at the same location,
 * unless allowMultiple is set for that type in signal-types.js.
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

        // --- dupCats: OSM categories that appear in more than one node ---
        const catCounts = new Map();
        for (const node of grpNodes) {
            for (const cat of node.categories) {
                catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
            }
        }
        const dupCats = [...catCounts.entries()]
            .filter(([, n]) => n > 1)
            .map(([cat]) => cat);

        // --- isDupType: signalType appearing in 2+ nodes without allowMultiple ---
        // Only the intruders are flagged — i.e. all feats sharing a type except
        // the one with the lowest networkId, which is considered the original.
        // Feats with no networkId fall back to keeping the first-seen as original.

        // Collect all feats per signalType across all nodes in this group.
        const typeFeats = new Map();
        for (const node of grpNodes) {
            for (const feat of node.feats) {
                const t = feat.p.signalType;
                if (!typeFeats.has(t)) typeFeats.set(t, []);
                typeFeats.get(t).push(feat);
                feat.p.isDupType = false; // default
            }
        }

        for (const [type, feats] of typeFeats) {
            if (feats.length <= 1) continue;
            const entry = getMappingEntry(type);
            if (entry?.allowMultiple) continue;

            // Sort by networkId numerically; feats without an id sort last
            // (treated as intruders since they lack a canonical identifier).
            const sorted = [...feats].sort((a, b) => {
                const na = parseInt(a.p.networkId ?? '', 10);
                const nb = parseInt(b.p.networkId ?? '', 10);
                const va = Number.isFinite(na) ? na : Infinity;
                const vb = Number.isFinite(nb) ? nb : Infinity;
                return va - vb;
            });
            // The first feat (lowest networkId) is the original — skip it.
            for (let i = 1; i < sorted.length; i++) {
                sorted[i].p.isDupType = true;
            }
        }

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

/**
 * signal-grouping.js - Pure OSM node grouping logic.
 *
 * Single source of truth for how co-located signals are distributed across
 * OSM nodes. No dependency on translation.js or any DOM module.
 *
 * Grouping rules - a signal can join an existing node group when ALL hold:
 *   1. direction  - matches the group's direction.
 *   2. placement  - matches the group's placement (left/right/bridge/...).
 *   3. category   - the signal's OSM cat is not already in the group.
 *   Unsupported signals (no SIGNAL_MAPPING entry) skip rules 2 and 3.
 *
 * linkedTo - network key affinity:
 *   A SIGNAL_MAPPING entry can declare linkedTo as a GAIA key string
 *   (e.g. "TIV D FIXE") or an array of such strings. These are primary keys
 *   of SIGNAL_MAPPING and equal to p.signalType in normalised signals.
 *
 * Sort order:
 *   Tier 0 - Anchor signals (their GAIA key is a linkedTo target in this batch).
 *            Must land first so linked signals can find their group.
 *   Tier 1 - Signals with linkedTo. Sorted by proximity to their nearest anchor
 *            signal's networkId so the closest signal claims the preferred slot
 *            before a distant outlier does (e.g. TIV D FIXE 160519 beats 10326116
 *            for the CARRE 160521 slot because |160519-160521|=2 vs ~10M).
 *   Tier 2 - Signals without linkedTo whose OSM cat is claimed by a tier-1 signal.
 *            Deferred so linked signals (e.g. Z) get priority for the slot.
 *   Tier 3 - Everything else: networkId cluster ascending, type priority ascending.
 *
 *   When multiple candidate groups qualify (same anchor key, canFit), the group
 *   whose anchor networkId is numerically closest to the signal's own networkId
 *   is preferred. SNCF-paired signals have quasi-consecutive identifiers.
 *
 * NodeGroup shape:
 *   { direction, placement, feats[], categories: Set<string>,
 *     networkKeys: Map<gaiaKey, string> }
 *   networkKeys maps each GAIA key in the group to the networkId of the signal
 *   that introduced it, used for proximity scoring.
 *
 * Public API:
 *   groupFeats(feats) -> NodeGroup[]
 *   canFit(feat, group) -> boolean
 *   getTypePriority(type) -> number
 *   getHighestPriorityType(types) -> string|null
 */

import { SIGNAL_MAPPING } from './signal-types.js';

// ===== Priority table =====

export const TYPE_PRIORITY = Object.freeze(
    Object.fromEntries(Object.keys(SIGNAL_MAPPING).map((key, i) => [key, i]))
);

const UNSUPPORTED_PRIORITY = Infinity;

export function getTypePriority(type) {
    return TYPE_PRIORITY[type] ?? UNSUPPORTED_PRIORITY;
}

export function getHighestPriorityType(types) {
    let best = null, bestRank = UNSUPPORTED_PRIORITY;
    for (const t of types) {
        const r = getTypePriority(t);
        if (r < bestRank) { bestRank = r; best = t; }
    }
    return best;
}

// ===== Public API =====

export function canFit(feat, group) {
    const mapping = SIGNAL_MAPPING[feat.p.signalType];
    if (group.direction !== feat.p.direction) return false;
    if (group.placement !== feat.p.placement) return false;
    if (!mapping) return true;
    return !group.categories.has(mapping.cat);
}

/**
 * Distribute feats into NodeGroups.
 *
 * @param {Array<{ p: object }>} feats
 * @returns {NodeGroup[]}
 */
export function groupFeats(feats) {
    const sorted = _sort(feats);
    const groups = [];

    for (const feat of sorted) {
        const mapping = SIGNAL_MAPPING[feat.p.signalType];
        const links = _links(mapping);
        let idx = -1;

        if (links.length > 0) {
            // Collect all candidate groups holding a linked anchor key.
            const candidates = [];
            for (let i = 0; i < groups.length; i++) {
                const g = groups[i];
                if (!canFit(feat, g)) continue;
                for (const link of links) {
                    if (g.networkKeys.has(link)) {
                        candidates.push({ i, anchorId: g.networkKeys.get(link) });
                        break;
                    }
                }
            }
            if (candidates.length === 1) {
                idx = candidates[0].i;
            } else if (candidates.length > 1) {
                // Prefer the candidate whose anchor networkId is closest to ours.
                const myId = _numId(feat.p.networkId);
                idx = candidates.reduce((best, c) =>
                    Math.abs(_numId(c.anchorId) - myId) <
                        Math.abs(_numId(best.anchorId) - myId) ? c : best
                ).i;
            }
        }

        if (idx === -1) idx = groups.findIndex(g => canFit(feat, g));

        if (idx === -1) {
            groups.push({
                direction: feat.p.direction,
                placement: feat.p.placement,
                feats: [feat],
                categories: mapping ? new Set([mapping.cat]) : new Set(),
                networkKeys: new Map([[feat.p.signalType, feat.p.networkId]]),
            });
        } else {
            groups[idx].feats.push(feat);
            groups[idx].networkKeys.set(feat.p.signalType, feat.p.networkId);
            if (mapping) groups[idx].categories.add(mapping.cat);
        }
    }

    return groups;
}

// ===== Private =====

function _links(mapping) {
    if (!mapping?.linkedTo) return [];
    return Array.isArray(mapping.linkedTo) ? mapping.linkedTo : [mapping.linkedTo];
}

function _numId(id) {
    const n = parseInt(id ?? '', 10);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Sort feats for deterministic grouping (see tier documentation in module header).
 *
 * @param {Array<{ p: object }>} feats
 * @returns {Array<{ p: object }>}
 */
function _sort(feats) {
    // Set of GAIA keys referenced as anchors in this batch.
    const anchorKeys = new Set();
    for (const feat of feats) {
        for (const k of _links(SIGNAL_MAPPING[feat.p.signalType])) anchorKeys.add(k);
    }

    // OSM cats claimed by signals with linkedTo (used to defer unlinked competitors).
    const linkedCats = new Set();
    for (const feat of feats) {
        const m = SIGNAL_MAPPING[feat.p.signalType];
        if (m && _links(m).length > 0) linkedCats.add(m.cat);
    }

    // For each anchor GAIA key, collect networkIds of all anchor signals in this batch.
    const anchorIds = new Map();
    for (const feat of feats) {
        if (!anchorKeys.has(feat.p.signalType)) continue;
        if (!anchorIds.has(feat.p.signalType)) anchorIds.set(feat.p.signalType, []);
        anchorIds.get(feat.p.signalType).push(_numId(feat.p.networkId));
    }

    // Minimum networkId distance from a feat to any of its anchor signals.
    const minDistToAnchor = feat => {
        const myId = _numId(feat.p.networkId);
        let min = Infinity;
        for (const link of _links(SIGNAL_MAPPING[feat.p.signalType])) {
            for (const anchorId of (anchorIds.get(link) ?? [])) {
                const d = Math.abs(anchorId - myId);
                if (d < min) min = d;
            }
        }
        return min;
    };

    const tier = feat => {
        const m = SIGNAL_MAPPING[feat.p.signalType];
        if (anchorKeys.has(feat.p.signalType)) return 0;
        if (_links(m).length > 0) return 1;
        if (m && linkedCats.has(m.cat)) return 2;
        return 3;
    };

    return [...feats].sort((a, b) => {
        const ta = tier(a), tb = tier(b);
        if (ta !== tb) return ta - tb;

        // Tier 1: closest-to-anchor first, so outliers don't steal preferred slots.
        if (ta === 1) {
            const da = minDistToAnchor(a), db = minDistToAnchor(b);
            if (da !== db) return da - db;
        }

        const clA = (a.p.networkId ?? '').slice(0, 4);
        const clB = (b.p.networkId ?? '').slice(0, 4);
        if (clA !== clB) return clA < clB ? -1 : 1;
        return getTypePriority(a.p.signalType) - getTypePriority(b.p.signalType);
    });
}

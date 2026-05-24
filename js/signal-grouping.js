/**
 * signal-grouping.js - Pure OSM node grouping logic.
 *
 * Contains the sort order and placement rules that determine how co-located
 * signals are distributed across OSM nodes. Has NO dependency on translation.js
 * or any other module with side-effects, making it safe to import from both
 * signal-mapping.js (main thread, full app) and conflict-detector.js
 * (validation tool, no translation context).
 *
 * This module is the single source of truth for the grouping algorithm.
 * signal-mapping.js calls groupFeats() then builds tags on top.
 * conflict-detector.js calls groupFeats() then analyses the groups for conflicts.
 *
 * Grouping rules - a signal can join an existing node group when ALL hold:
 *   1. direction  - must match the group's direction.
 *   2. placement  - must match the group's placement (left/right/bridge/...).
 *      Signals on physically different sides of the track are separate nodes.
 *   3. category   - the signal's OSM cat must not already appear in the group.
 *      Each physical node carries at most one signal per OSM category.
 *   Unsupported signals (no SIGNAL_MAPPING entry) satisfy rules 2 and 3
 *   automatically - they never produce a category conflict.
 *
 * Sort order applied before placement:
 *   a. Signals with linkedTo sort after any signal that matches their link
 *      criteria, ensuring the anchor signal lands in a group first.
 *   b. Within the same tier: networkId cluster (first 4 digits) ascending,
 *      then type priority ascending.
 *
 * Group selection for signals with linkedTo:
 *   The placement loop iterates the linkedTo entries in order and picks the
 *   first group that already holds a signal matching all specified criteria
 *   (cat and/or type) and can still accept the new signal (canFit). Falls back
 *   to the first available group when no linked group is found.
 *
 *   linkedTo is normalised internally to an array, so both the single-object
 *   form { cat, type } and the array form [{...}, {...}] are supported.
 *
 * NodeGroup shape:
 *   { direction, placement, feats[], categories: Set<string>, types: Set<string> }
 *   categories tracks OSM cats present (for cat-based linking).
 *   types      tracks OSM type values present (for type-based linking).
 *
 * Public API:
 *   groupFeats(feats) -> NodeGroup[]
 *   canFit(feat, group) -> boolean
 */

import { SIGNAL_MAPPING } from './signal-types.js';

// ===== Priority table =====

/** Priority lookup derived from SIGNAL_MAPPING insertion order. */
export const TYPE_PRIORITY = Object.freeze(
    Object.fromEntries(Object.keys(SIGNAL_MAPPING).map((type, i) => [type, i]))
);

const UNSUPPORTED_PRIORITY = Infinity;

/**
 * @param {string} type
 * @returns {number}
 */
export function getTypePriority(type) {
    return TYPE_PRIORITY[type] ?? UNSUPPORTED_PRIORITY;
}

/**
 * Determines the signal type with the highest priority from a list.
 * @param {string[]} types
 * @returns {string|null}
 */
export function getHighestPriorityType(types) {
    let primaryType = null;
    let primaryPriority = UNSUPPORTED_PRIORITY;

    for (const type of types) {
        const priority = getTypePriority(type);
        if (priority < primaryPriority) {
            primaryPriority = priority;
            primaryType = type;
        }
    }
    return primaryType;
}


// ===== Public API =====

/**
 * Returns true when feat can be added to group without conflicts.
 * Exported so that consumers (e.g. conflict-detector.js) can test
 * individual placement decisions without re-implementing the rules.
 *
 * @param {{ p: { signalType: string, direction: string, placement: string } }} feat
 * @param {{ direction: string, placement: string, categories: Set<string> }}   group
 * @returns {boolean}
 */
export function canFit(feat, group) {
    const mapping = SIGNAL_MAPPING[feat.p.signalType];
    if (group.direction !== feat.p.direction) return false;
    if (group.placement !== feat.p.placement) return false;
    if (!mapping) return true;                           // unsupported: no cat conflict
    return !group.categories.has(mapping.cat);
}

/**
 * Distribute feats into NodeGroups following the grouping rules above.
 * Returns the groups in the order they were created (i.e. in the order the
 * first signal of each group appears in the sorted input).
 *
 * Callers that need the result in original feat order (e.g. getOsmNodes for
 * tag output) must apply their own index remapping afterwards.
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

        // Try each linkedTo entry in order; use the first group that matches.
        for (const link of links) {
            idx = groups.findIndex(g => _matchesLink(g, link) && canFit(feat, g));
            if (idx !== -1) break;
        }

        // Fallback: first available group.
        if (idx === -1) {
            idx = groups.findIndex(g => canFit(feat, g));
        }

        if (idx === -1) {
            groups.push({
                direction: feat.p.direction,
                placement: feat.p.placement,
                feats: [feat],
                categories: mapping ? new Set([mapping.cat]) : new Set(),
                types: mapping ? new Set([mapping.type]) : new Set(),
            });
        } else {
            groups[idx].feats.push(feat);
            if (mapping) {
                groups[idx].categories.add(mapping.cat);
                groups[idx].types.add(mapping.type);
            }
        }
    }

    return groups;
}

// ===== Private =====

/**
 * Normalise a SIGNAL_MAPPING entry's linkedTo field to an array.
 * Returns an empty array when no affinity is defined.
 *
 * @param {object|undefined} mapping
 * @returns {Array<{ cat?: string, type?: string }>}
 */
function _links(mapping) {
    if (!mapping?.linkedTo) return [];
    return Array.isArray(mapping.linkedTo) ? mapping.linkedTo : [mapping.linkedTo];
}

/**
 * Returns true when a group already contains a signal matching a linkedTo entry.
 * Both cat and type criteria are optional; only the fields present in the link
 * object are checked.
 *
 * @param {{ categories: Set<string>, types: Set<string> }} group
 * @param {{ cat?: string, type?: string }} link
 * @returns {boolean}
 */
function _matchesLink(group, link) {
    if (link.cat && !group.categories.has(link.cat)) return false;
    if (link.type && !group.types.has(link.type)) return false;
    return true;
}

/**
 * Sort feats for stable, deterministic grouping.
 * Signals with linkedTo sort after any signal that matches their link criteria,
 * ensuring the anchor signal lands in a group first.
 *
 * @param {Array<{ p: object }>} feats
 * @returns {Array<{ p: object }>}
 */
function _sort(feats) {
    return [...feats].sort((a, b) => {
        const mA = SIGNAL_MAPPING[a.p.signalType];
        const mB = SIGNAL_MAPPING[b.p.signalType];

        // A links to B's signal (any of A's linkedTo entries matches B's cat/type)
        // -> A must sort after B so B's group exists when A is placed.
        const aLinksToB = _links(mA).some(link =>
            (!link.cat || link.cat === mB?.cat) &&
            (!link.type || link.type === mB?.type)
        );
        const bLinksToA = _links(mB).some(link =>
            (!link.cat || link.cat === mA?.cat) &&
            (!link.type || link.type === mA?.type)
        );

        if (aLinksToB && !bLinksToA) return 1;
        if (bLinksToA && !aLinksToB) return -1;

        // Secondary: networkId cluster (first 4 digits) then type priority.
        const clA = (a.p.networkId ?? '').slice(0, 4);
        const clB = (b.p.networkId ?? '').slice(0, 4);
        if (clA !== clB) return clA < clB ? -1 : 1;
        return getTypePriority(a.p.signalType) - getTypePriority(b.p.signalType);
    });
}


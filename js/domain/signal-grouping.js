// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * signal-grouping.js - Pure OSM node grouping logic.
 *
 * No dependency on translation.js, DOM, or any module with side-effects.
 *
 * Pipeline (called by groupFeats):
 *   1. _detectMechanical(feats)            - check for mechanical combo once per location
 *   2. Build idMap: Map<feat, number>       - parse networkId strings to integers once,
 *                                            stored in a local Map to preserve object immutability
 *   3. _sortFeats(feats, isMech, idMap)    - establish processing order: tiers + numeric networkId
 *   4. _distributeToNodes(sorted, isMech, idMap) - place each signal into a node
 *
 * networkId integers are stored in a Map keyed by feat reference, not on the feat
 * object itself. This avoids object mutation and the delete anti-pattern (which
 * destroys the object's hidden class in V8, forcing dictionary mode).
 *
 * Sort order:
 *   Tier 0 - Anchor signals (their GAIA key is a linkedTo target in this batch).
 *             Processed first so linked signals can find their node.
 *   Tier 1 - Signals with an active linkedTo, sorted by ascending networkId distance
 *             to their nearest anchor. Closest signal claims the preferred slot first.
 *   Tier 2 - Signals without linkedTo whose OSM cat is already claimed by a Tier-1
 *             signal. Deferred so the linked signal gets priority.
 *   Tier 3 - Everything else, sorted by ascending numeric networkId.
 *
 * canFit rules (a signal can join an existing node when ALL hold):
 *   1. direction matches the node's direction.
 *   2. placement matches the node's placement.
 *   3. The signal's OSM cat is not already in the node.
 *   Unknown signals (not in SIGNAL_MAPPING) skip rules 2 and 3.
 *
 * Public API:
 *   groupFeats(feats) -> { nodeGroups: NodeGroup[], isMech: boolean }
 *   canFit(feat, group) -> boolean
 *   getTypePriority(type) -> number
 *   getHighestPriorityType(types) -> string|null
 *
 * NodeGroup shape:
 *   { direction, placement, feats[], categories: Set<string>,
 *     networkKeys: Map<gaiaKey, number> }
 *   networkKeys stores parsed integers so proximity arithmetic requires no parsing.
 */

import { getMappingEntry, getMappingKeys, isMechanicalCombo } from './signal-types.js';

// ===== Priority table =====
// Built once from SIGNAL_MAPPING insertion order (luminous signals only).
// Always-mechanical types (R30, RR30) get Infinity — placed after luminous signals.

export const TYPE_PRIORITY = Object.freeze(
    Object.fromEntries(getMappingKeys().map((key, i) => [key, i]))
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

/**
 * Determine whether a signal can join an existing node group.
 * Uses _catSlot() so signals with the same cat but different subcats
 * (e.g. two ETCS markers with distinct sub-functions) can share a node.
 */
export function canFit(feat, group) {
    const entry = getMappingEntry(feat.p.signalType);
    if (group.direction !== feat.p.direction) return false;
    if (group.placement !== feat.p.placement) return false;
    if (!entry) return true;  // unknown signal: skip cat check
    return !group.categories.has(_catSlot(entry));
}

/**
 * Group co-located features into OSM node groups.
 *
 * @param {Array<{p: object}>} feats  All signals at one physical location.
 * @returns {{ nodeGroups: NodeGroup[], isMech: boolean }}
 *   isMech is returned so callers (signal-mapping.js, validate-main.js) can pass
 *   it to buildNodeTags without re-computing mechanical detection.
 */
export function groupFeats(feats) {
    const isMech = _detectMechanical(feats);

    // Parse networkId strings once per feat. Stored in a Map keyed by object
    // reference — no mutation of feat objects, no hidden class invalidation.
    const idMap = new Map(feats.map(f => [f, _parseId(f.p.networkId)]));

    const sorted = _sortFeats(feats, isMech, idMap);
    const nodeGroups = _distributeToNodes(sorted, isMech, idMap);
    return { nodeGroups, isMech };
}

// ===== Private helpers =====

/**
 * Effective OSM category slot for a mapping entry.
 * When an entry has a subcat (e.g. "REP TGV" with subcat="main"),
 * the slot is "cat:subcat" — two signals with the same cat but
 * different subcats occupy different slots and do NOT conflict.
 * Entries without subcat use cat alone (existing behaviour).
 *
 * @param {{ cat: string, subcat?: string }} entry
 * @returns {string}
 */
function _catSlot(entry) {
    return entry.subcat ? `${entry.cat}:${entry.subcat}` : entry.cat;
}

// ===== Private — pipeline steps =====

/**
 * Step 1: detect whether this location is a mechanical installation.
 * Delegates to isMechanicalCombo() in signal-types.js.
 */
function _detectMechanical(feats) {
    return isMechanicalCombo(new Set(feats.map(f => f.p.signalType)));
}

/**
 * Step 3: sort feats into processing order.
 *
 * isMech selects the active linkedTo for signals with both sections
 * (e.g. A mechanical links to CARRE; A luminous has no linkedTo).
 * idMap provides pre-parsed integers for all arithmetic comparisons.
 *
 * @param {Array<{p: object}>}    feats
 * @param {boolean}               isMech
 * @param {Map<object, number>}   idMap
 * @returns {Array<{p: object}>}
 */
function _sortFeats(feats, isMech, idMap) {
    // Anchor keys: types referenced as linkedTo targets in this batch (Tier 0).
    const anchorKeys = new Set();
    for (const feat of feats) {
        for (const k of _activeLinks(feat.p.signalType, isMech)) anchorKeys.add(k);
    }

    // OSM cats claimed by Tier-1 signals — used to defer unlinked competitors (Tier 2).
    const linkedCats = new Set();
    for (const feat of feats) {
        const links = _activeLinks(feat.p.signalType, isMech);
        if (links.length > 0) {
            const entry = getMappingEntry(feat.p.signalType);
            if (entry) linkedCats.add(_catSlot(entry));
        }
    }

    // Parsed networkIds of every anchor signal, indexed by GAIA key.
    const anchorIds = new Map();
    for (const feat of feats) {
        if (!anchorKeys.has(feat.p.signalType)) continue;
        if (!anchorIds.has(feat.p.signalType)) anchorIds.set(feat.p.signalType, []);
        anchorIds.get(feat.p.signalType).push(idMap.get(feat));
    }

    return [...feats].sort((a, b) => {
        const ta = _tier(a, anchorKeys, linkedCats, isMech);
        const tb = _tier(b, anchorKeys, linkedCats, isMech);
        if (ta !== tb) return ta - tb;

        // Within Tier 1: closest-to-anchor first so the most relevant signal
        // claims the preferred slot before distant outliers do.
        if (ta === 1) {
            const da = _minDistToAnchor(a, anchorIds, isMech, idMap);
            const db = _minDistToAnchor(b, anchorIds, isMech, idMap);
            if (da !== db) return da - db;
        }

        // All other tiers: ascending networkId for deterministic order.
        return idMap.get(a) - idMap.get(b);
    });
}

/**
 * Step 4: place sorted feats into NodeGroups using canFit / best-proximity-fit.
 *
 * Two-phase placement per signal:
 *   Phase 1 — Explicit link: _findLinkedGroup() for signals with an active linkedTo.
 *   Phase 2 — Proximity: _bestFitGroup() for all other signals.
 *             When multiple groups can accept the signal, the one whose networkIds
 *             are collectively closest to the signal's own networkId is chosen.
 *             This prevents a signal from landing in the first available group when
 *             a numerically closer group exists (first-fit artefact).
 *
 * isMech is passed to _findLinkedGroup so it selects the correct linkedTo
 * based on the mechanical/luminous context (critical fix from code review).
 *
 * @param {Array<{p: object}>}   sorted
 * @param {boolean}              isMech
 * @param {Map<object, number>}  idMap
 * @returns {NodeGroup[]}
 */
function _distributeToNodes(sorted, isMech, idMap) {
    const groups = [];

    for (const feat of sorted) {
        const entry = getMappingEntry(feat.p.signalType);
        let idx = _findLinkedGroup(feat, groups, isMech, idMap);
        if (idx === -1) idx = _bestFitGroup(feat, groups, idMap);

        if (idx === -1) {
            groups.push({
                direction: feat.p.direction,
                placement: feat.p.placement,
                feats: [feat],
                categories: entry ? new Set([_catSlot(entry)]) : new Set(),
                networkKeys: new Map([[feat.p.signalType, idMap.get(feat)]]),
            });
        } else {
            groups[idx].feats.push(feat);
            groups[idx].networkKeys.set(feat.p.signalType, idMap.get(feat));
            if (entry) groups[idx].categories.add(_catSlot(entry));
        }
    }

    return groups;
}

/**
 * Find the best-fit group for a signal that has no active linkedTo target.
 *
 * Selection criteria, applied in order:
 *   1. Group priority — prefer the group whose highest-priority signal has the
 *      lowest TYPE_PRIORITY index (i.e. appears earliest in SIGNAL_MAPPING).
 *      A group containing CARRE always wins over one containing only TIV D FIXE.
 *   2. NetworkId proximity — tiebreaker when two groups share the same best
 *      signal priority. Closer networkId wins.
 *
 * This prevents signals from being pulled into a secondary group by a smaller
 * networkId delta when the primary group has a more important anchor signal:
 *   e.g. TECS 10038280 joins the group with CARRE 63936 even if its id is
 *   numerically closer to a secondary group containing only TSCS signals.
 *
 * @param {object}             feat
 * @param {NodeGroup[]}        groups
 * @param {Map<object,number>} idMap
 * @returns {number}  Group index, or -1 when no group can accept the signal.
 */
function _bestFitGroup(feat, groups, idMap) {
    const candidates = [];
    for (let i = 0; i < groups.length; i++) {
        if (canFit(feat, groups[i])) candidates.push(i);
    }

    if (candidates.length === 0) return -1;
    if (candidates.length === 1) return candidates[0];

    const myId = idMap.get(feat);
    let bestIdx = candidates[0];
    let bestPriority = _groupBestPriority(groups[candidates[0]]);
    let bestDelta = _groupMinDelta(groups[candidates[0]], myId);

    for (let ci = 1; ci < candidates.length; ci++) {
        const i = candidates[ci];
        const priority = _groupBestPriority(groups[i]);
        const delta = _groupMinDelta(groups[i], myId);

        if (priority < bestPriority
            || (priority === bestPriority && delta < bestDelta)) {
            bestIdx = i;
            bestPriority = priority;
            bestDelta = delta;
        }
    }

    return bestIdx;
}

/** Return the lowest TYPE_PRIORITY value (= highest importance) among all feats in a group. */
function _groupBestPriority(group) {
    let best = UNSUPPORTED_PRIORITY;
    for (const f of group.feats) {
        const p = getTypePriority(f.p.signalType);
        if (p < best) best = p;
    }
    return best;
}

/** Return the minimum absolute networkId distance between targetId and any id in the group. */
function _groupMinDelta(group, targetId) {
    let min = Infinity;
    for (const gId of group.networkKeys.values()) {
        const d = Math.abs(gId - targetId);
        if (d < min) min = d;
    }
    return min;
}


// ===== Private — sort helpers =====

/**
 * Return the active linkedTo targets for a signal type, respecting isMech.
 *
 * Signals with default/mechanical sections pick the active section's linkedTo:
 *   A mechanical (isMech=true)  → mechanical.linkedTo = 'CARRE'
 *   A luminous   (isMech=false) → default has no linkedTo → []
 *
 * Legacy flat-structure signals (luminous-only) use top-level linkedTo.
 *
 * @param {string}  signalType
 * @param {boolean} isMech
 * @returns {string[]}
 */
function _activeLinks(signalType, isMech) {
    const entry = getMappingEntry(signalType);
    if (!entry) return [];
    if (entry.default || entry.mechanical) {
        const section = isMech ? entry.mechanical : entry.default;
        const raw = section?.linkedTo ?? null;
        return raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    }
    const raw = entry.linkedTo ?? null;
    return raw ? (Array.isArray(raw) ? raw : [raw]) : [];
}

/**
 * Assign a processing tier to a feat.
 * @returns {0|1|2|3}
 */
function _tier(feat, anchorKeys, linkedCats, isMech) {
    const { signalType } = feat.p;
    if (anchorKeys.has(signalType)) return 0;
    if (_activeLinks(signalType, isMech).length > 0) return 1;
    const entry = getMappingEntry(signalType);
    if (entry && linkedCats.has(_catSlot(entry))) return 2;
    return 3;
}

/**
 * Minimum distance from a Tier-1 feat's parsed networkId to any of its anchor
 * signals' parsed networkIds. Determines sort order within Tier 1.
 *
 * @param {object}             feat
 * @param {Map<string,number[]>} anchorIds
 * @param {boolean}            isMech
 * @param {Map<object,number>} idMap
 * @returns {number}
 */
function _minDistToAnchor(feat, anchorIds, isMech, idMap) {
    const id = idMap.get(feat);
    let min = Infinity;
    for (const link of _activeLinks(feat.p.signalType, isMech)) {
        for (const anchorId of (anchorIds.get(link) ?? [])) {
            const d = Math.abs(anchorId - id);
            if (d < min) min = d;
        }
    }
    return min;
}

// ===== Private — distribution helpers =====

/**
 * Find the best existing group for a signal with active linkedTo links.
 *
 * isMech is forwarded to _activeLinks so the correct linkedTo is used:
 * a luminous A returns [] (no link), a mechanical A returns ['CARRE'].
 * Without isMech, entry.mechanical?.linkedTo would always be evaluated first
 * by the nullish coalescing operator, incorrectly linking luminous A to CARRE.
 *
 * When multiple groups hold a matching anchor key, the one whose anchor
 * networkId is closest to the signal's own networkId is preferred.
 *
 * @param {object}             feat
 * @param {NodeGroup[]}        groups
 * @param {boolean}            isMech
 * @param {Map<object,number>} idMap
 * @returns {number}  Group index, or -1 when no linked group found.
 */
function _findLinkedGroup(feat, groups, isMech, idMap) {
    const links = _activeLinks(feat.p.signalType, isMech);
    if (links.length === 0) return -1;

    const candidates = [];
    for (let i = 0; i < groups.length; i++) {
        if (!canFit(feat, groups[i])) continue;
        for (const link of links) {
            if (groups[i].networkKeys.has(link)) {
                candidates.push({ i, anchorId: groups[i].networkKeys.get(link) });
                break;
            }
        }
    }

    if (candidates.length === 0) return -1;
    if (candidates.length === 1) return candidates[0].i;

    // Multiple candidates: prefer the one whose anchor networkId is closest.
    const id = idMap.get(feat);
    return candidates.reduce((best, c) =>
        Math.abs(c.anchorId - id) < Math.abs(best.anchorId - id) ? c : best
    ).i;
}

// ===== Private — utilities =====

/** Parse a networkId string to a finite integer, or 0 on failure. */
function _parseId(networkId) {
    const n = parseInt(networkId ?? '', 10);
    return Number.isFinite(n) ? n : 0;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * outlier-detector.js - Outlier identification for co-located signal groups.
 *
 * Determines which instance of a duplicated signal type is the "outlier"
 * (the one that does not belong to the main cluster at a given location) so
 * that groupFeats() can place it in a secondary OSM node.
 *
 * Algorithm (per duplicate type T):
 *   1. For each candidate instance of T, compute an isolation score:
 *      the minimum absolute networkId delta between the candidate and every
 *      other feat at the location (other types + other instances of T).
 *   2. The candidate with the HIGHEST score is the outlier -- it is the most
 *      distant from the cluster (likely entered in a different survey batch).
 *   3. Tiebreaker: higher networkId = outlier (more recent = more likely a dup).
 *   4. All other instances remain in the primary node.
 *
 * networkIds are pre-parsed once per call to avoid repeated parseInt across
 * the inner loops.
 *
 * Public API:
 *   markOutliers(feats) -> Set<feat>
 */

import { getMappingEntry } from '../domain/signal-types.js';

/**
 * Return the set of feats that should land in secondary (suspect) nodes.
 *
 * The caller (validate.js _detectConflicts) uses the returned Set to sort
 * feats before passing them to groupFeats(): originals first, outliers last.
 * No property is written on any feat.p object.
 *
 * @param {object[]} feats  All feats at one location group.
 * @returns {Set<object>}   Subset of feats identified as outliers.
 */
export function markOutliers(feats) {
    const outliers = new Set();

    // Pre-parse all networkIds once to avoid repeated parseInt in inner loops.
    const numId = new Map(
        feats.map(f => [f, parseInt(f.p.networkId ?? '', 10)])
    );

    // Group feats by signal type.
    const typeFeats = new Map();
    for (const feat of feats) {
        const t = feat.p.signalType;
        if (!typeFeats.has(t)) typeFeats.set(t, []);
        typeFeats.get(t).push(feat);
    }

    for (const [type, dupes] of typeFeats) {
        // No conflict for unique types, or types that explicitly allow multiple nodes.
        if (dupes.length <= 1) continue;
        if (getMappingEntry(type)?.allowMultiple) continue;

        // Numeric IDs of all feats that are NOT this type (context cluster).
        const otherIds = feats
            .filter(f => f.p.signalType !== type)
            .map(f => numId.get(f))
            .filter(Number.isFinite);

        // Score each candidate: isolation from (other-type feats + other same-type instances).
        const scored = dupes.map(candidate => {
            const cid = numId.get(candidate);
            const primaryIds = [
                ...otherIds,
                ...dupes
                    .filter(d => d !== candidate)
                    .map(d => numId.get(d))
                    .filter(Number.isFinite),
            ];
            return { feat: candidate, score: _isolation(cid, primaryIds) };
        });

        // Sort ascending by isolation score -- original (lowest isolation) stays first.
        // Tiebreaker: lower networkId = original (more established entry).
        scored.sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            const na = numId.get(a.feat);
            const nb = numId.get(b.feat);
            const va = Number.isFinite(na) ? na : Infinity;
            const vb = Number.isFinite(nb) ? nb : Infinity;
            return va - vb;
        });

        // First entry = original; all others = outliers.
        for (let i = 1; i < scored.length; i++) {
            outliers.add(scored[i].feat);
        }
    }

    return outliers;
}

/**
 * Minimum absolute delta between candidateId and any id in primaryIds.
 * Returns 0 when the candidate has no valid id or the primary cluster is empty.
 *
 * @param {number}   candidateId  Pre-parsed numeric networkId of the candidate.
 * @param {number[]} primaryIds   Pre-parsed numeric networkIds of the primary cluster.
 * @returns {number}
 */
function _isolation(candidateId, primaryIds) {
    if (!Number.isFinite(candidateId) || primaryIds.length === 0) return 0;
    let min = Infinity;
    for (const pid of primaryIds) {
        const d = Math.abs(candidateId - pid);
        if (d < min) min = d;
    }
    return min;
}

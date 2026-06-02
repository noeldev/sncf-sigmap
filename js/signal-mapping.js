// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * signal-mapping.js
 * Logic for signal type classification, OSM node generation, and tag building.
 *
 * The signal data tables are private to signal-types.js. This module uses
 * the public API exclusively: getMappingEntry(), isMapped(),
 * getAllMappingEntries(), getAllMappingKeys().
 *
 * Display colors come from group-mapping.js (application groups, legend palette).
 * OSM category keys (railway:signal:<cat>) are built exclusively in osm-tags.js.
 *
 * @reference https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

import { getColorForGroup, getUnsupportedGroup } from './group-mapping.js';
import {
    getMappingEntry, getMappingEntries, getMappingKeys,
    getGroupForType, isMapped,
} from './signal-types.js';
import { groupFeats, getHighestPriorityType } from './signal-grouping.js';
import { buildNodeTags } from './osm-tags.js';

// ===== Public API =====

/**
 * Return the display color for a signal type.
 * Uses the luminous (default) group from getMappingEntry.
 * Falls back to UNSUPPORTED color for unknown or always-mechanical types.
 * @param {string} signalType
 * @returns {string}
 */
export function getTypeColor(signalType) {
    // getGroupForType checks both SIGNAL_MAPPING and MECHANICAL_MAPPING so that
    // always-mechanical types (R30, RR30) display the correct legend color.
    const group = getGroupForType(signalType) ?? getUnsupportedGroup();
    return getColorForGroup(group);
}

/**
 * Return the display color of the highest-priority signal type in a list.
 * @param {string[]} types
 * @returns {string}
 */
export function getPrimaryTypeColor(types) {
    const primaryType = getHighestPriorityType(types);
    return primaryType
        ? getTypeColor(primaryType)
        : getColorForGroup(getUnsupportedGroup());
}

/**
 * Return true when the type has a luminous (SIGNAL_MAPPING) entry.
 * Use isMapped() from signal-types.js when mechanical types also qualify.
 * @param {string} signalType
 * @returns {boolean}
 */
export function isSupported(signalType) {
    return getMappingEntry(signalType) !== null;
}

/**
 * Sort signals by networkId numerically.
 * @param {object[]} feats
 * @returns {object[]}
 */
export function sortSignalsByNetworkId(feats) {
    return [...feats].sort((a, b) =>
        (a.p.networkId ?? '').localeCompare(b.p.networkId ?? '', undefined, { numeric: true })
    );
}

/**
 * Return all signal types for a display group.
 * @param {string} group  display group key, e.g. 'main', 'distant'
 * @returns {string[]}
 */
export function getTypesByGroup(group) {
    return _typesByGroupCache().get(group) ?? [];
}

/**
 * Register types from the dataset to classify unsupported signals.
 * Uses isMapped() so always-mechanical types (R30, RR30) are not flagged
 * as unsupported after being moved out of SIGNAL_MAPPING.
 * @param {string[]} allTypes
 */
export function registerDataTypes(allTypes) {
    _typesByGroupCache().set(getUnsupportedGroup(), allTypes.filter(type => !isMapped(type)));
}


/**
 * Return the Set of all luminous signal type keys.
 * Returns the SAME Set on every call — do not mutate.
 * Used by filters.js for the "supported only" toggle dot indicator.
 * @returns {Set<string>}
 */
const _supportedTypes = new Set(getMappingKeys());
export function getSupportedTypes() { return _supportedTypes; }

// ===== Private helpers =====

/** @type {Map<string, string[]> | null} */
let _groupCache = null;

function _typesByGroupCache() {
    if (!_groupCache) {
        _groupCache = new Map();
        for (const [type, def] of getMappingEntries()) {
            if (!_groupCache.has(def.group)) _groupCache.set(def.group, []);
            _groupCache.get(def.group).push(type);
        }
    }
    return _groupCache;
}

// ===== OSM Node Computation =====

/**
 * Group features into OSM nodes and build tags for each node.
 * @param {object[]} feats
 * @returns {{ nodes: object[], featToNodeIdx: Map }}
 */
export function getOsmNodes(feats) {
    if (!feats.length) return { nodes: [], featToNodeIdx: new Map() };

    // groupFeats returns isMech alongside nodeGroups so we pass it to buildNodeTags
    // without re-computing mechanical detection for every individual node.
    const { nodeGroups, isMech } = groupFeats(feats);
    const rawNodeIdx = new Map();

    for (let gi = 0; gi < nodeGroups.length; gi++) {
        for (const feat of nodeGroups[gi].feats) {
            rawNodeIdx.set(feat, gi);
        }
    }

    const indexRemap = new Map();
    for (const feat of feats) {
        const old = rawNodeIdx.get(feat);
        if (!indexRemap.has(old)) indexRemap.set(old, indexRemap.size);
    }

    const nodes = new Array(nodeGroups.length);
    for (const [oldIdx, newIdx] of indexRemap) {
        const groupFeatsArr = nodeGroups[oldIdx].feats;
        const id = groupFeatsArr.map(f => f.p.networkId || f.p.signalType).sort().join('|');
        nodes[newIdx] = {
            id,
            index: newIdx,
            tags: buildNodeTags(groupFeatsArr, { isMech }),
        };
    }

    const featToNodeIdx = new Map();
    for (const [feat, oldIdx] of rawNodeIdx) {
        featToNodeIdx.set(feat, indexRemap.get(oldIdx));
    }

    return { nodes, featToNodeIdx };
}

/**
 * Compute a legible foreground color (black or white) for a given hex background.
 * Uses the W3C relative luminance weights.
 * Shared between signal-popup.js and report-renderer.js.
 * @param {string} hex  6-digit hex, e.g. '#e00000'
 * @returns {'#000'|'#fff'}
 */
export function contrastColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#000' : '#fff';
}

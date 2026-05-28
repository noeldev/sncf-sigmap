/**
 * signal-mapping.js
 * Logic for signal type classification, OSM node conflict resolution,
 * tag generation, and public API for signal data management.
 *
 * The SIGNAL_MAPPING data table is imported from signal-types.js.
 * See signal-types.js for the detailed entry field documentation.
 *
 * Tags added automatically for every node:
 *   railway=signal
 *   railway:position:exact    — milepost converted to decimal km (e.g. "077+305" → "77.305")
 *   railway:signal:direction  — forward | backward | both (one per node)
 *   railway:signal:position   — bridge | right | left
 *   railway:signal:<cat>:ref  — networkId
 *   ref=*                     — signal marker plate text (if any)
 *   source=SNCF - 03/2022     — always written last
 *
 * Node grouping rules:
 *   Fully delegated to signal-grouping.js (groupFeats / canFit).
 *   getOsmNodes() calls groupFeats(), then builds OSM tags on top of the
 *   resulting NodeGroups. See signal-grouping.js for the complete rule set.
 *
 * @reference https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

import { getColorForCategory } from './cat-mapping.js';
import { t } from './translation.js';
import { SIGNAL_MAPPING } from './signal-types.js';
import { groupFeats, getHighestPriorityType } from './signal-grouping.js';
import { buildNodeTags } from './osm-tags.js';

// ===== Internal Helpers =====

// ===== Public API =====

/**
 * Returns the display color for a specific signal type.
 * @param {string} signalType
 * @returns {string} Hex color code.
 */
export function getTypeColor(signalType) {
    const group = SIGNAL_MAPPING[signalType]?.group ?? 'unsupported';
    return getColorForCategory(group);
}

/**
 * Returns the color of the most important signal type in a list.
 * @param {string[]} types
 * @returns {string} Hex color code.
 */
export function getPrimaryTypeColor(types) {
    const primaryType = getHighestPriorityType(types);
    return primaryType
        ? getTypeColor(primaryType)
        : getColorForCategory('unsupported');
}

/**
 * Checks if a signal type is supported by the current mapping.
 * @param {string} signalType
 * @returns {boolean}
 */
export function isSupported(signalType) {
    return !!SIGNAL_MAPPING[signalType];
}

/**
 * Sorts signals by their networkId numerically.
 * @param {object[]} feats
 * @returns {object[]}
 */
export function sortSignalsByNetworkId(feats) {
    return [...feats].sort((a, b) =>
        (a.p.networkId ?? '').localeCompare(b.p.networkId ?? '', undefined, { numeric: true })
    );
}

/**
 * Retrieves all signal types associated with a specific display group.
 * @param {string} group
 * @returns {string[]}
 */
export function getTypesByGroup(group) {
    return _typesByGroupCache().get(group) ?? [];
}

/**
 * Registers types present in the current dataset to classify unsupported signals.
 * @param {string[]} allTypes
 */
export function registerDataTypes(allTypes) {
    _typesByGroupCache().set('unsupported', allTypes.filter(type => !SIGNAL_MAPPING[type]));
}

/** @type {Map<string, string[]> | null} */
let _groupCache = null;

/**
 * Lazily computes the mapping between display groups and signal types.
 * @returns {Map<string, string[]>}
 */
function _typesByGroupCache() {
    if (!_groupCache) {
        _groupCache = new Map();
        for (const [type, def] of Object.entries(SIGNAL_MAPPING)) {
            if (!_groupCache.has(def.group)) _groupCache.set(def.group, []);
            _groupCache.get(def.group).push(type);
        }
    }
    return _groupCache;
}

/**
 * Returns the OSM :ref tag key for a given signal type.
 * @param {string} signalType
 * @returns {string|null}
 */
export function getSignalId(signalType) {
    const entry = SIGNAL_MAPPING[signalType];
    return entry ? `railway:signal:${entry.cat}:ref` : null;
}

/**
 * Return the set of all signal types that have an ORM mapping.
 * Returns the SAME Set instance on every call — do not mutate.
 * @returns {Set<string>}
 */
const _supportedTypes = new Set(Object.keys(SIGNAL_MAPPING));
export function getSupportedTypes() { return _supportedTypes; }

// ===== OSM Node Computation =====

/**
 * Groups features into OSM nodes and generates corresponding tags.
 * Grouping logic is fully delegated to signal-grouping.js groupFeats().
 *
 * @param {object[]} feats
 * @returns {{ nodes: object[], featToNodeIdx: Map }}
 */
export function getOsmNodes(feats) {
    if (!feats.length) return { nodes: [], featToNodeIdx: new Map() };

    // groupFeats() applies the canonical sort and placement rules.
    const nodeGroups = groupFeats(feats);
    const rawNodeIdx = new Map();

    for (let gi = 0; gi < nodeGroups.length; gi++) {
        for (const feat of nodeGroups[gi].feats) {
            rawNodeIdx.set(feat, gi);
        }
    }

    // Remap node indices to follow the original (unsorted) feat order.
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
            tags: buildNodeTags(groupFeatsArr, { fixmeLabel: t('osm.fixme.label') }),
        };
    }

    const featToNodeIdx = new Map();
    for (const [feat, oldIdx] of rawNodeIdx) {
        featToNodeIdx.set(feat, indexRemap.get(oldIdx));
    }

    return { nodes, featToNodeIdx };
}

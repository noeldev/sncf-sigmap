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
 *   railway:signal:<cat>:ref  — networkId (suffixed when a forward partner exists in same cat)
 *   ref=*                     - signal marker plate text (if any)
 *   source=SNCF - 03/2022     — always written last
 *
 *   Each physical signal gets its own node when directions differ.
 *
 * Unsupported signal types:
 * Signals whose `signalType` is not in SIGNAL_MAPPING contribute a fixme= tag
 * that aggregates all unsupported signals on the node.
 * As long as they face the same direction, they are grouped on the same node
 * as mapped signals at the same location.
 *
 * @reference https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

import { milepostToDecimalKm } from './sncf-convert.js';
import { getColorForCategory } from './cat-mapping.js';
import { t } from './translation.js';
import { SIGNAL_MAPPING } from './signal-types.js';

// ===== Constants & Priority Mapping =====

/**
 * Pre-computed lookup map for signal priority.
 * Used for O(1) complexity in priority comparisons.
 */
const TYPE_PRIORITY = Object.freeze(
    Object.fromEntries(
        Object.keys(SIGNAL_MAPPING).map((type, index) => [type, index])
    )
);

/**
 * Priority value for unsupported signals (lowest priority).
 */
const UNSUPPORTED_PRIORITY = Infinity;

/**
 * Returns the numeric priority for a given signal type.
 * @param {string} type - The signal type code.
 * @returns {number} The priority rank.
 */
function getTypePriority(type) {
    return TYPE_PRIORITY[type] ?? UNSUPPORTED_PRIORITY;
}

// ===== Internal Helpers =====

/**
 * Checks if a feature can be merged into an existing node group without conflicts.
 * @param {Object} feat - The signal feature to evaluate.
 * @param {Object} group - The current node group context.
 * @returns {boolean} True if the feature can fit.
 * @private
 */
function _canFit(feat, group) {
    const mapping = SIGNAL_MAPPING[feat.p.signalType];
    
    // Direction must match existing group signals
    if (group.direction !== feat.p.direction) return false;
    
    // Unsupported signals never conflict on category
    if (!mapping) return true;
    
    // Category must be unique within the node
    return !group.categories.has(mapping.cat);
}

/**
 * Writes standard node metadata tags.
 * @param {Map<string, string>} tags - The OSM tags map to populate.
 * @param {Object} first - The first signal properties in the group.
 * @private
 */
function _writeCommonTags(tags, first) {
    tags.set('railway', 'signal');
    tags.set('railway:position:exact', milepostToDecimalKm(first.milepost));
    
    if (first.direction !== 'unknown') {
        tags.set('railway:signal:direction', first.direction);
    }
    if (first.placement !== 'unknown') {
        tags.set('railway:signal:position', first.placement);
    }
}

/**
 * Writes OSM tags for a mapped signal.
 * @param {Object} feat - The signal feature.
 * @param {Object} mapping - The configuration mapping for this signal type.
 * @param {Map<string, string>} tags - The tags map.
 * @private
 */
function _writeSignalTags(feat, mapping, tags) {
    const prefix = `railway:signal:${mapping.cat}`;
    tags.set(prefix, mapping.type);
    
    for (const [k, v] of Object.entries(mapping.properties || {})) {
        tags.set(`${prefix}:${k}`, v);
    }
    
    if (feat.p.networkId) {
        tags.set(`${prefix}:ref`, feat.p.networkId);
    }
}

/**
 * Builds the 'fixme' tag for unsupported signals.
 * @param {Map<string, string>} tags - The tags map.
 * @param {Map<string, string[]>} unsupportedByType - Map of types to their network IDs.
 * @private
 */
function _writeUnsupportedFixme(tags, unsupportedByType) {
    if (unsupportedByType.size === 0) return;

    const items = [];
    for (const [type, ids] of unsupportedByType) {
        const idsStr = ids.length ? ids.join(', ') : '';
        if (type) {
            items.push(idsStr ? `'${type}' (${idsStr})` : `'${type}'`);
        } else if (idsStr) {
            items.push(idsStr);
        }
    }

    const content = items.join('; ') || '?';
    tags.set('fixme', t('osm.fixme', content));
}

/**
 * Builds the complete OSM tag Map for a group of signals.
 * @param {Array} feats - Array of signals belonging to the node.
 * @returns {Map<string, string>} Sorted map of OSM tags.
 * @private
 */
function _buildNodeTags(feats) {
    const tags = new Map();
    const first = feats[0].p;

    _writeCommonTags(tags, first);

    const unsupportedByType = new Map();

    for (const feat of feats) {
        const { signalType, networkId } = feat.p;
        const mapping = SIGNAL_MAPPING[signalType];

        if (mapping) {
            _writeSignalTags(feat, mapping, tags);
        } else {
            if (!unsupportedByType.has(signalType)) {
                unsupportedByType.set(signalType, []);
            }
            if (networkId) {
                unsupportedByType.get(signalType).push(networkId);
            }
        }
    }

    _writeUnsupportedFixme(tags, unsupportedByType);

    tags.set('source', 'SNCF - 03/2022');

    return tags;
}

// ===== Public API =====

/**
 * Returns the display color for a specific signal type.
 * @param {string} signalType - The signal type key.
 * @returns {string} Hex color code.
 */
export function getTypeColor(signalType) {
    const group = SIGNAL_MAPPING[signalType]?.group ?? 'unsupported';
    return getColorForCategory(group);
}

/**
 * Determines the signal type with the highest priority from a list.
 * @param {string[]} types - Array of signal type codes.
 * @returns {string|null} The type with highest priority.
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

/**
 * Returns the color of the most important signal type in a list.
 * @param {string[]} types - Array of signal type codes.
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
 * @param {string} signalType - The signal type code.
 * @returns {boolean} True if supported.
 */
export function isSupported(signalType) {
    return !!SIGNAL_MAPPING[signalType];
}

/**
 * Sorts signals by their networkId numerically.
 * @param {Array} feats - Array of signals.
 * @returns {Array} A new sorted array of signals.
 */
export function sortSignalsByNetworkId(feats) {
    return [...feats].sort((a, b) =>
        (a.p.networkId ?? '').localeCompare(b.p.networkId ?? '', undefined, { numeric: true })
    );
}

/**
 * Retrieves all signal types associated with a specific display group.
 * @param {string} group - Group name (e.g., 'main', 'shunting').
 * @returns {string[]} List of signal types.
 */
export function getTypesByGroup(group) {
    return _typesByGroupCache().get(group) ?? [];
}

/**
 * Registers types present in the current dataset to classify unsupported signals.
 * @param {string[]} allTypes - List of all signal types in the dataset.
 */
export function registerDataTypes(allTypes) {
    _typesByGroupCache().set('unsupported', allTypes.filter(type => !SIGNAL_MAPPING[type]));
}

/** @type {Map<string, string[]> | null} */
let _groupCache = null;

/**
 * Lazily computes the mapping between display groups and signal types.
 * @returns {Map<string, string[]>}
 * @private
 */
function _typesByGroupCache() {
    if (!_groupCache) {
        _groupCache = new Map();
        for (const [type, def] of Object.entries(SIGNAL_MAPPING)) {
            if (!_groupCache.has(def.group)) {
                _groupCache.set(def.group, []);
            }
            _groupCache.get(def.group).push(type);
        }
    }
    return _groupCache;
}

/**
 * Returns the OSM :ref tag key for a given signal type.
 * @param {string} signalType - The signal type code.
 * @returns {string|null} The key (e.g., "railway:signal:main:ref") or null.
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
 * Extracts the first 4 digits of a networkId for clustering.
 * @param {string} networkId - The signal network ID.
 * @returns {string} The cluster key.
 * @private
 */
function _idrCluster(networkId) {
    return networkId ? String(networkId).slice(0, 4) : '';
}

/**
 * Groups features into OSM nodes and generates corresponding tags.
 * @param {Array} feats - The raw signal features.
 * @returns {Object} { nodes: OsmNode[], featToNodeIdx: Map<feat, number> }
 */
export function getOsmNodes(feats) {
    if (!feats.length) return { nodes: [], featToNodeIdx: new Map() };

    // Sort to keep clusters of IDs together, prioritizing mapped signals
    const sorted = [...feats].sort((a, b) => {
        const clA = _idrCluster(a.p.networkId);
        const clB = _idrCluster(b.p.networkId);
        if (clA !== clB) return clA < clB ? -1 : 1;
        return getTypePriority(a.p.signalType) - getTypePriority(b.p.signalType);
    });

    const nodeGroups = [];
    const rawNodeIdx = new Map();

    for (const feat of sorted) {
        let idx = nodeGroups.findIndex(g => _canFit(feat, g));
        
        if (idx === -1) {
            const mapping = SIGNAL_MAPPING[feat.p.signalType];
            nodeGroups.push({
                feats: [feat],
                direction: feat.p.direction,
                categories: mapping ? new Set([mapping.cat]) : new Set()
            });
            idx = nodeGroups.length - 1;
        } else {
            const group = nodeGroups[idx];
            group.feats.push(feat);
            const mapping = SIGNAL_MAPPING[feat.p.signalType];
            if (mapping) {
                group.categories.add(mapping.cat);
            }
        }
        rawNodeIdx.set(feat, idx);
    }

    // Remap node indices to follow original order
    const indexRemap = new Map();
    for (const feat of feats) {
        const old = rawNodeIdx.get(feat);
        if (!indexRemap.has(old)) indexRemap.set(old, indexRemap.size);
    }

    const nodes = new Array(nodeGroups.length);
    for (const [oldIdx, newIdx] of indexRemap) {
        const groupFeats = nodeGroups[oldIdx].feats;
        const id = groupFeats.map(f => f.p.networkId || f.p.signalType).sort().join('|');
        
        nodes[newIdx] = {
            id,
            index: newIdx,
            tags: _buildNodeTags(groupFeats),
        };
    }

    const featToNodeIdx = new Map();
    for (const [feat, oldIdx] of rawNodeIdx) {
        featToNodeIdx.set(feat, indexRemap.get(oldIdx));
    }

    return { nodes, featToNodeIdx };
}

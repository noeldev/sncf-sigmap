/**
 * signal-mapping.js — Signal type logic: node conflict resolution, tag building, public API.
 *
 * The SIGNAL_MAPPING data table lives in signal-types.js (imported below).
 * See signal-types.js for the entry field documentation.
 *
 * SIGNAL_MAPPING entry fields (reference):
 *   group      — application display category key (defined in cat-mapping.js)
 *   cat        — ORM tag category:  railway:signal:<cat>=…
 *   type       — ORM main value:    railway:signal:<cat>=<type>
 *   properties — ORM sub-tags:      railway:signal:<cat>:<key>=<value>
 *                (only static values; ref and direction are handled separately)
 *
 * Tags added automatically for every node:
 *   railway=signal
 *   railway:position:exact    — milepost converted to decimal km (e.g. "077+305" → "77.305")
 *   railway:signal:direction  — forward | backward | both (one per node)
 *   railway:signal:position   — bridge | right | left
 *   railway:signal:<cat>:ref  — networkId (suffixed when a forward partner exists in same cat)
 *   source=SNCF - 03/2022     — always written last
 *
 *   Each physical signal gets its own node when directions differ.
 *
 * Reference: https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

import { milepostToDecimalKm } from './sncf-convert.js';
import { getColorForCategory } from './cat-mapping.js';

import { SIGNAL_MAPPING } from './signal-types.js';

// Type priority list derived once from SIGNAL_MAPPING insertion order.
// Pre-computed so getOsmNodes does not rebuild it on every popup open.
const PRIORITY = Object.keys(SIGNAL_MAPPING);


// ===== Node conflict resolution =====

/**
 * Returns true when the incoming feature can be placed in the given group
 * without producing conflicting OSM tags.
 *
 * Two conditions must both hold:
 *   1. Same direction — every signal on a node faces the same way, matching
 *      the JOSM preset model where one node = one physical signal location.
 *   2. No category conflict — each ORM category maps to a unique tag key prefix
 *      (railway:signal:<cat>), so two signals of the same category on the same
 *      node would overwrite each other.
 */
function _canFit(feat, group) {
    const cat1 = SIGNAL_MAPPING[feat.p.signalType].cat;
    const dir1 = feat.p.direction;
    return group.every(other =>
        other.p.direction === dir1 &&
        SIGNAL_MAPPING[other.p.signalType].cat !== cat1
    );
}


// ===== OSM tag construction =====

/**
 * Write all OSM tags for one signal into the tags Map.
 *
 *   railway:signal:<cat>           = <type>
 *   railway:signal:<cat>:<propKey> = <propVal>  (all properties)
 *   railway:signal:<cat>:ref       = <networkId>
 */
function _writeSignalTags(prefix, feat, tags) {
    const e = SIGNAL_MAPPING[feat.p.signalType];
    tags.set(prefix, e.type);
    for (const [k, v] of Object.entries(e.properties || {})) {
        tags.set(`${prefix}:${k}`, v);
    }
    if (feat.p.networkId) tags.set(`${prefix}:ref`, feat.p.networkId);
}

/**
 * Build the complete OSM tag Map for one node group.
 *
 * Steps:
 *   1. Determine direction from the first signal in the group (all signals in
 *      a group share the same direction — enforced by _canFit).
 *   2. Write common node header tags.
 *   3. Write per-signal tags via _writeSignalTags.
 *   4. Append source=SNCF - 03/2022.
 */
function _buildNodeTags(group) {
    const tags = new Map();

    tags.set("railway", "signal");
    tags.set("railway:position:exact", milepostToDecimalKm(group[0].p.milepost));
    // direction and placement are already in OSM notation after normalizeSignal.
    if (group[0].p.direction !== "unknown") tags.set("railway:signal:direction", group[0].p.direction);
    if (group[0].p.placement !== "unknown") tags.set("railway:signal:position", group[0].p.placement);

    for (const feat of group) {
        const prefix = `railway:signal:${SIGNAL_MAPPING[feat.p.signalType].cat}`;
        _writeSignalTags(prefix, feat, tags);
    }

    tags.set("source", "SNCF - 03/2022");
    return tags;
}

// ===== Public query functions =====

/** Return the display color for any signalType. */
export function getTypeColor(signalType) {
    const group = SIGNAL_MAPPING[signalType]?.group ?? 'unsupported';
    return getColorForCategory(group);
}

/** Return true when this signalType has an OSM mapping. */
export function isSupported(signalType) {
    return !!SIGNAL_MAPPING[signalType];
}

/**
 * Return all signalType keys belonging to the given display group.
 * Used by filters.js to populate a signalType filter from a legend category click.
 * @param {string} group  Group name (e.g. 'main', 'shunting').
 * @returns {string[]}
 */
export function getTypesByGroup(group) {
    return Object.entries(SIGNAL_MAPPING)
        .filter(([, def]) => def.group === group)
        .map(([type]) => type);
}

/**
 * Return the OSM :ref tag key for a given signalType, or null if unsupported.
 * Example: "CARRE" -> "railway:signal:main:ref"
 */
export function getSignalId(signalType) {
    const entry = SIGNAL_MAPPING[signalType];
    return entry ? `railway:signal:${entry.cat}:ref` : null;
}

/** Set of all signalType values that have a mapping. Exported for filters.js. */
const _supportedTypes = new Set(Object.keys(SIGNAL_MAPPING));
export function getSupportedTypes() { return _supportedTypes; }

// ===== OSM node computation =====

/**
 * Returns the first 4 digits of a networkId string as a cluster key.
 * Signals with the same 4-digit prefix are considered numerically related
 * and are sorted together before the node-grouping pass.
 * Signals without a networkId use an empty string so they sort last.
 */
function _idrCluster(networkId) {
    return networkId ? String(networkId).slice(0, 4) : '';
}

/**
 * Group co-located features into one or more OSM nodes, respecting ORM tagging
 * conflict rules, then build the complete tag Map for each node.
 *
 * Features are sorted by SIGNAL_MAPPING insertion order (priority) so that
 * more important signal types occupy earlier nodes and appear first in tags.
 *
 * Returns:
 *   {
 *     nodes:         OsmNode[]          — one entry per OSM node to create
 *     featToNodeIdx: Map<feat, number>  — which node index each feat belongs to
 *   }
 *
 * OsmNode:
 *   { id: string, index: number, tags: Map<string,string> }
 *
 * Unsupported features are silently skipped and absent from featToNodeIdx.
 * nodes is empty when all features at this location are unsupported types.
 */
export function getOsmNodes(feats) {
    const supported = feats.filter(f => isSupported(f.p.signalType));

    if (!supported.length) return { nodes: [], featToNodeIdx: new Map() };

    // Sort so signals with similar networkId prefixes are processed consecutively.
    // This increases the chance that numerically close signals (e.g. 94560-94563)
    // share a node when their cats allow it, while unrelated clusters (e.g. 118480+)
    // naturally go to separate nodes. Within a cluster, SIGNAL_MAPPING priority
    // order is preserved so higher-priority types still claim the best node first.
    supported.sort((a, b) => {
        const clA = _idrCluster(a.p.networkId);
        const clB = _idrCluster(b.p.networkId);
        if (clA !== clB) return clA < clB ? -1 : 1;
        return PRIORITY.indexOf(a.p.signalType) - PRIORITY.indexOf(b.p.signalType);
    });

    const nodeGroups = [];
    const rawNodeIdx = new Map();

    for (const feat of supported) {
        let idx = nodeGroups.findIndex(g => _canFit(feat, g));
        if (idx === -1) {
            nodeGroups.push([]);
            idx = nodeGroups.length - 1;
        }
        nodeGroups[idx].push(feat);
        rawNodeIdx.set(feat, idx);
    }

    // Remap node indices to follow the original feats order so that
    // signal 1 -> node 1, signal 2 -> node 2, never swapped.
    const indexRemap = new Map();
    for (const feat of feats) {
        if (!rawNodeIdx.has(feat)) continue;
        const old = rawNodeIdx.get(feat);
        if (!indexRemap.has(old)) indexRemap.set(old, indexRemap.size);
    }

    const nodes = new Array(nodeGroups.length);
    for (const [oldIdx, newIdx] of indexRemap) {
        const group = nodeGroups[oldIdx];
        const id = group.map(f => f.p.networkId || f.p.signalType).sort().join('|');
        nodes[newIdx] = {
            id,
            index: newIdx,
            tags: _buildNodeTags(group)
        };
    }

    const featToNodeIdx = new Map();
    for (const [feat, oldIdx] of rawNodeIdx) {
        featToNodeIdx.set(feat, indexRemap.get(oldIdx));
    }

    return { nodes, featToNodeIdx };
}

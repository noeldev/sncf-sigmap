/**
 * signal-mapping.js
 * Signal type mapping: signalType → display category + OpenRailwayMap node/tag computation.
 *
 * _SIGNAL_MAPPING entry fields:
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

// Signal type definitions ordered by priority (highest first).
// Priority controls which signals occupy earlier nodes when conflicts arise.
// Private; all access goes through the public API below.
const _SIGNAL_MAPPING = {

    // Main signals
    "CARRE": {
        group: "main",
        cat: "main",
        type: "FR:CARRE",
        properties: {
            form: "light",
            plate: "FR:NF",
            shape: "FR:C",
            states: "FR:C;FR:VL"
        }
    },
    "R30": {
        group: "main",
        cat: "main",
        type: "FR:CARRE",
        properties: {
            form: "light",
            plate: "FR:NF",
            shape: "FR:F",
            states: "FR:C;FR:VL;FR:R"
        }
    },
    "RR30": {
        group: "main",
        cat: "main",
        type: "FR:CARRE",
        properties: {
            form: "light",
            plate: "FR:NF",
            shape: "FR:H",
            states: "FR:C;FR:VL;FR:RR"
        }
    },
    "CV": {
        group: "main",
        cat: "main",
        type: "FR:CV",
        properties: {
            form: "light",
            plate: "FR:NF",
            shape: "FR:C",
            states: "FR:CV;FR:M"
        }
    },
    "S": {
        group: "main",
        cat: "main",
        type: "FR:S",
        properties: {
            form: "light",
            plate: "FR:F",
            shape: "FR:C",
            states: "FR:S;FR:VL"
        }
    },
    "GA": {
        group: "main",
        cat: "main",
        type: "FR:GA",
        properties: {
            form: "light"
        }
    },
    "VOIE CONV": {
        group: "main",
        cat: "main",
        type: "FR:TLC",
        properties: {
            form: "light"
        }
    },

    // Distant signals
    "CARRE A": {
        group: "distant",
        cat: "distant",
        type: "FR:CARRE_A",
        properties: {
            form: "sign"
        }
    },
    "A": {
        group: "distant",
        cat: "distant",
        type: "FR:A",
        properties: {
            form: "light",
            states: "FR:A;FR:VL"
        }
    },
    "D": {
        group: "distant",
        cat: "distant",
        type: "FR:D",
        properties: {
            form: "light",
            states: "FR:D;FR:A;FR:VL"
        }
    },

    // Speed limits
    "TIV D MOB": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D_MOB",
        properties: {
            form: "light"
        }
    },
    "TIV R MOB": {
        group: "speedLimit",
        cat: "speed_limit_reminder",
        type: "FR:TIV-R_MOB",
        properties: {
            form: "light"
        }
    },
    "TIV D FIXE": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D_FIXE",
        properties: {
            form: "sign",
            shape: "square"
        }
    },
    "TIVD B FIX": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D_B_FIXE",
        properties: {
            type: "FR:B",
            form: "sign"
        }
    },
    "TIVD C FIX": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D_C_FIXE",
        properties: {
            type: "FR:C",
            form: "sign"
        }
    },
    "P": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:P",
        properties: {
            form: "sign"
        }
    },
    "Z": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:Z",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "R": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:R",
        properties: {
            form: "sign",
            function: "exit"
        }
    },
    "CHEVRON": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:CHEVRON",
        properties: {
            type: "downwards",
            form: "sign"
        }
    },
    "TIV PENDIS": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D",
        properties: {
            form: "sign",
            shape: "pentagon",
        }
    },
    "TIV PENEXE": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:TIV",
        properties: {
            form: "sign",
            shape: "pentagon",
            function: "entry"
        }
    },
    "TIV PENREP": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:TIV",
        properties: {
            form: "sign",
            shape: "pentagon",
            function: "exit"
        }
    },
    "REPER VIT": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:KM",
        properties: {
            type: "speed_marker",
            form: "sign"
        }
    },

    // Route indicators
    "ID": {
        group: "route",
        cat: "route",
        type: "FR:ID",
        properties: {
            form: "light",
            states: "FR:ID1;FR:ID2"
        }
    },
    "IDD": {
        group: "route",
        cat: "route_distant",
        type: "FR:TIDD",
        properties: {
            form: "light"
        }
    },
    "TLD": {
        group: "route",
        cat: "route_distant",
        type: "FR:TLD",
        properties: {
            form: "light"
        }
    },

    // Stop signs
    "ARRET VOY": {
        group: "stop",
        cat: "stop",
        type: "FR:ARRET_TT",
        properties: {
            form: "sign"
        }
    },

    // Level crossings
    "PN...": {
        group: "crossing",
        cat: "crossing_hint",
        type: "FR:PN_A",
        properties: {
            form: "sign"
        }
    },
    "PN": {
        group: "crossing",
        cat: "crossing_info",
        type: "FR:PN",
        properties: {
            form: "sign"
        }
    },

    // Traction electricity
    "SECT": {
        group: "electricity",
        cat: "electricity",
        type: "FR:SECT",
        properties: {
            type: "power_off_advance",
            form: "sign"
        }
    },
    "CC EXE": {
        group: "electricity",
        cat: "electricity",
        type: "FR:CC",
        properties: {
            type: "power_off",
            form: "sign",
            function: "entry"
        }
    },
    "CC FIN": {
        group: "electricity",
        cat: "electricity",
        type: "FR:CC",
        properties: {
            type: "power_on",
            form: "sign",
            function: "exit"
        }
    },
    "REV": {
        group: "electricity",
        cat: "electricity",
        type: "FR:REV",
        properties: {
            type: "power_on",
            form: "sign",
            function: "exit"
        }
    },
    "BP DIS": {
        group: "electricity",
        cat: "electricity",
        type: "FR:BP",
        properties: {
            type: "pantograph_down_advance",
            form: "sign"
        }
    },
    "BP EXE": {
        group: "electricity",
        cat: "electricity",
        type: "FR:BP",
        properties: {
            type: "pantograph_down",
            form: "sign",
            function: "entry"
        }
    },
    "BP FIN": {
        group: "electricity",
        cat: "electricity",
        type: "FR:BP",
        properties: {
            type: "pantograph_up",
            form: "sign",
            function: "exit"
        }
    },
    "FIN CAT": {
        group: "electricity",
        cat: "electricity",
        type: "FR:CAT",
        properties: {
            type: "end_of_catenary",
            form: "sign"
        }
    },
    "GIVRE": {
        group: "electricity",
        cat: "electricity",
        type: "FR:GIVRE",
        properties: {
            form: "sign"
        }
    },
    "BIMODE A": {
        group: "electricity",
        cat: "dual_mode",
        type: "FR:BIMODE_A",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "BIMODE": {
        group: "electricity",
        cat: "dual_mode",
        type: "FR:BIMODE",
        properties: {
            form: "sign",
            function: "exit"
        }
    },

    // Cab signalling (TVM)
    "CAB E": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:CAB_E",
        properties: {
            form: "sign"
        }
    },
    "CAB R": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:CAB_R",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "CAB S": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:CAB_S",
        properties: {
            form: "sign",
            function: "exit"
        }
    },
    "REP TVM": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:TVM",
        properties: {
            form: "sign",
            function: "block_marker"
        }
    },
    "REP TGV": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:ETCS",
        properties: {
            form: "sign",
            function: "stop_marker"
        }
    },

    // Wrong-road (IPCS)
    "TECS": {
        group: "wrongRoad",
        cat: "wrong_road",
        type: "FR:TECS",
        properties: {
            form: "light",
            function: "entry"
        }
    },
    "TSCS": {
        group: "wrongRoad",
        cat: "wrong_road",
        type: "FR:TSCS",
        properties: {
            form: "light",
            function: "exit"
        }
    },

    // Stop signs (extended set)
    "ARRET A": {
        group: "stop",
        cat: "stop_distant",
        type: "FR:ARRET_A",
        properties: {
            form: "sign"
        }
    },
    "ARRET": {
        group: "stop",
        cat: "stop",
        type: "FR:ARRET",
        properties: {
            form: "sign"
        }
    },
    "ATC": {
        group: "stop",
        cat: "stop",
        type: "FR:ATC",
        properties: {
            form: "sign"
        }
    },
    "GARE": {
        group: "stop",
        cat: "stop",
        type: "FR:GARE",
        properties: {
            form: "sign"
        }
    },
    "JAL ARRET": {
        group: "stop",
        cat: "stop",
        type: "FR:JALON",
        properties: {
            type: "stop_marker",
            form: "sign"
        }
    },
    "STOP": {
        group: "stop",
        cat: "stop",
        type: "FR:STOP",
        properties: {
            form: "sign"
        }
    },

    // Station and facilities
    "APPROCHETS": {
        group: "station",
        cat: "station_distant",
        type: "FR:ETS",
        properties: {
            form: "sign"
        }
    },
    "APPROETSA": {
        group: "station",
        cat: "station_distant",
        type: "FR:ETS_A",
        properties: {
            form: "sign"
        }
    },
    "LIMITETS": {
        group: "station",
        cat: "station",
        type: "FR:LIMITE_ETS",
        properties: {
            form: "sign"
        }
    },
    "SLD": {
        group: "station",
        cat: "departure",
        type: "FR:SLD",
        properties: {
            form: "light"
        }
    },

    // Shunting
    "IDP": {
        group: "shunting",
        cat: "shunting",
        type: "FR:TIP",
        properties: {
            form: "light"
        }
    },
    "JAL MAN": {
        group: "shunting",
        cat: "shunting",
        type: "FR:JALON",
        properties: {
            form: "sign"
        }
    },
    "DEPOT": {
        group: "shunting",
        cat: "shunting",
        type: "FR:D",
        properties: {
            form: "sign"
        }
    },
    "G": {
        group: "shunting",
        cat: "shunting",
        type: "FR:G",
        properties: {
            form: "sign"
        }
    },
    "IMP": {
        group: "shunting",
        cat: "shunting",
        type: "FR:IMP",
        properties: {
            form: "sign"
        }
    },
    "LGR": {
        group: "shunting",
        cat: "shunting",
        type: "FR:LGR",
        properties: {
            form: "sign"
        }
    },
    "LM": {
        group: "shunting",
        cat: "shunting",
        type: "FR:LM",
        properties: {
            form: "sign"
        }
    },
    "MV": {
        group: "shunting",
        cat: "shunting",
        type: "FR:MV",
        properties: {
            form: "sign"
        }
    },
    "HEURT...": {
        group: "shunting",
        cat: "shunting",
        type: "FR:HEURTOIR",
        properties: {
            type: "buffer_stop",
            form: "sign"
        }
    },
    "SLM": {
        group: "shunting",
        cat: "shunting",
        type: "FR:SLM",
        properties: {
            form: "light"
        }
    },

    // Miscellaneous
    "GABARIT": {
        group: "miscellaneous",
        cat: "main",
        type: "FR:GABARIT",
        properties: {
            form: "sign"
        }
    },
    "SIFFLER": {
        group: "miscellaneous",
        cat: "whistle",
        type: "FR:SIFFLER",
        properties: {
            form: "sign"
        }
    },
};

// Type priority list derived once from _SIGNAL_MAPPING insertion order.
// Pre-computed so getOsmNodes does not rebuild it on every popup open.
const _PRIORITY = Object.keys(_SIGNAL_MAPPING);


/* ===== Node conflict resolution ===== */

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
    const cat1 = _SIGNAL_MAPPING[feat.p.signalType].cat;
    const dir1 = feat.p.direction;
    return group.every(other =>
        other.p.direction === dir1 &&
        _SIGNAL_MAPPING[other.p.signalType].cat !== cat1
    );
}


/* ===== OSM tag construction ===== */

/**
 * Write all OSM tags for one signal into the tags Map.
 *
 *   railway:signal:<cat>           = <type>
 *   railway:signal:<cat>:<propKey> = <propVal>  (all properties)
 *   railway:signal:<cat>:ref       = <networkId>
 */
function _writeSignalTags(prefix, feat, tags) {
    const e = _SIGNAL_MAPPING[feat.p.signalType];
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
        const prefix = `railway:signal:${_SIGNAL_MAPPING[feat.p.signalType].cat}`;
        _writeSignalTags(prefix, feat, tags);
    }

    tags.set("source", "SNCF - 03/2022");
    return tags;
}

/* ===== Public query functions ===== */

/** Return the display color for any signalType. */
export function getTypeColor(signalType) {
    const group = _SIGNAL_MAPPING[signalType]?.group ?? 'unsupported';
    return getColorForCategory(group);
}

/** Return true when this signalType has an OSM mapping. */
export function isSupported(signalType) {
    return !!_SIGNAL_MAPPING[signalType];
}

/**
 * Return all signalType keys belonging to the given display group.
 * Used by filters.js to populate a signalType filter from a legend category click.
 * @param {string} group  Group name (e.g. 'main', 'shunting').
 * @returns {string[]}
 */
export function getTypesByGroup(group) {
    return Object.entries(_SIGNAL_MAPPING)
        .filter(([, def]) => def.group === group)
        .map(([type]) => type);
}

/**
 * Return the OSM :ref tag key for a given signalType, or null if unsupported.
 * Example: "CARRE" -> "railway:signal:main:ref"
 */
export function getSignalId(signalType) {
    const entry = _SIGNAL_MAPPING[signalType];
    return entry ? `railway:signal:${entry.cat}:ref` : null;
}

/** Set of all signalType values that have a mapping. Exported for filters.js. */
const _supportedTypes = new Set(Object.keys(_SIGNAL_MAPPING));
export function getSupportedTypes() { return _supportedTypes; }

/* ===== OSM node computation ===== */

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
 * Features are sorted by _SIGNAL_MAPPING insertion order (priority) so that
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
    // naturally go to separate nodes. Within a cluster, _SIGNAL_MAPPING priority
    // order is preserved so higher-priority types still claim the best node first.
    supported.sort((a, b) => {
        const clA = _idrCluster(a.p.networkId);
        const clB = _idrCluster(b.p.networkId);
        if (clA !== clB) return clA < clB ? -1 : 1;
        return _PRIORITY.indexOf(a.p.signalType) - _PRIORITY.indexOf(b.p.signalType);
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

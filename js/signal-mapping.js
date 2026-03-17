/**
 * signal-mapping.js
 * SNCF type_if → display category + OpenRailwayMap node/tag computation.
 *
 * _SIGNAL_MAPPING entry fields:
 *   group      — application display category (colour and legend; keys into _CATEGORY_INFO)
 *   cat        — ORM tag category:  railway:signal:<cat>=…
 *   type       — ORM main value:    railway:signal:<cat>=<type>
 *   properties — ORM sub-tags:      railway:signal:<cat>:<key>=<value>
 *                (only static values; ref and direction are handled separately)
 *
 * Tags added automatically for every node:
 *   railway=signal
 *   railway:position:exact    — PK converted to decimal km (e.g. "077+305" → "77.305")
 *   railway:signal:direction  — forward | backward | both
 *   railway:signal:position   — bridge | right | left
 *   railway:signal:<cat>:ref  — idreseau (suffixed when a forward partner exists in same cat)
 *   source=SNCF - 03/2022     — always written last
 *
 * :backward suffix rules — see _buildNodeTags() for the complete algorithm.
 *
 * Reference: https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

// Application display categories — used only for marker colours and the legend.
// Private; consumers call getTypeColor() / buildLegend().
const _CATEGORY_INFO = {
    "main":             "#e00000",
    "distant":          "#ffc010",
    "speed_limit":      "#ff8000",
    "route":            "#00b0d0",
    "train_protection": "#4060c0",
    "electricity":      "#a00060",
    "wrong_road":       "#00a0a0",
    "crossing":         "#b09000",
    "stop":             "#f040b0",
    "station":          "#008040",
    "shunting":         "#a050e0",
    "miscellaneous":    "#a0b0c0",
    "unsupported":      "#607070",
};

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
        group: "speed_limit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D_MOB",
        properties: {
            form: "light",
            states: "open;closed"
        }
    },
    "TIV R MOB": {
        group: "speed_limit",
        cat: "speed_limit_reminder",
        type: "FR:TIV-R_MOB",
        properties: {
            form: "light",
            states: "open;closed"
        }
    },
    "TIV D FIXE": {
        group: "speed_limit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D_FIXE",
        properties: {
            form: "sign",
            shape: "square"
        }
    },
    "TIVD B FIX": {
        group: "speed_limit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D_B_FIXE",
        properties: {
            type: "FR:B",
            form: "sign"
        }
    },
    "TIVD C FIX": {
        group: "speed_limit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D_C_FIXE",
        properties: {
            type: "FR:C",
            form: "sign"
        }
    },
    "P": {
        group: "speed_limit",
        cat: "speed_limit",
        type: "FR:P",
        properties: {
            form: "sign"
        }
    },
    "Z": {
        group: "speed_limit",
        cat: "speed_limit",
        type: "FR:Z",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "R": {
        group: "speed_limit",
        cat: "speed_limit",
        type: "FR:R",
        properties: {
            form: "sign",
            function: "exit"
        }
    },
    "CHEVRON": {
        group: "speed_limit",
        cat: "speed_limit",
        type: "FR:CHEVRON",
        properties: {
            type: "downwards",
            form: "sign"
        }
    },
    "TIV PENDIS": {
        group: "speed_limit",
        cat: "speed_limit_distant",
        type: "FR:TIV-PENDIS",
        properties: {
            form: "sign"
        }
    },
    "TIV PENEXE": {
        group: "speed_limit",
        cat: "speed_limit",
        type: "FR:TIV-PENEXE",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "TIV PENREP": {
        group: "speed_limit",
        cat: "speed_limit",
        type: "FR:TIV-PENREP",
        properties: {
            form: "sign",
            function: "exit",
            speed: "none"
        }
    },
    "REPER VIT": {
        group: "speed_limit",
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
            form: "light"
        }
    },
    "IDD": {
        group: "route",
        cat: "route_distant",
        type: "FR:TIDD",
        properties: {
            form: "light",
            states: "off;left;right"
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
        type: "FR:CC_EXE",
        properties: {
            type: "power_off",
            form: "sign",
            function: "entry"
        }
    },
    "CC FIN": {
        group: "electricity",
        cat: "electricity",
        type: "FR:CC_FIN",
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
        type: "FR:BP_DIS",
        properties: {
            type: "pantograph_down_advance",
            form: "sign"
        }
    },
    "BP EXE": {
        group: "electricity",
        cat: "electricity",
        type: "FR:BP_EXE",
        properties: {
            type: "pantograph_down",
            form: "sign",
            function: "entry"
        }
    },
    "BP FIN": {
        group: "electricity",
        cat: "electricity",
        type: "FR:BP_FIN",
        properties: {
            type: "pantograph_up",
            form: "sign",
            function: "exit"
        }
    },
    "FIN CAT": {
        group: "electricity",
        cat: "electricity",
        type: "FR:FIN_CAT",
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

    // Cab signalling / ETCS
    "CAB E": {
        group: "train_protection",
        cat: "train_protection",
        type: "FR:CAB_E",
        properties: {
            form: "sign"
        }
    },
    "CAB R": {
        group: "train_protection",
        cat: "train_protection",
        type: "FR:CAB_E",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "CAB S": {
        group: "train_protection",
        cat: "train_protection",
        type: "FR:CAB_S",
        properties: {
            form: "sign",
            function: "exit"
        }
    },
    "REP TVM": {
        group: "train_protection",
        cat: "train_protection",
        type: "FR:TVM",
        properties: {
            form: "sign",
            function: "block_marker"
        }
    },
    "REP TGV": {
        group: "train_protection",
        cat: "train_protection",
        type: "FR:ETCS",
        properties: {
            form: "sign",
            function: "stop_marker"
        }
    },

    // Wrong-road (IPCS)
    "TECS": {
        group: "wrong_road",
        cat: "wrong_road",
        type: "FR:TECS",
        properties: {
            form: "light",
            function: "entry"
        }
    },
    "TSCS": {
        group: "wrong_road",
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
        type: "FR:APPROCHE_ETS",
        properties: {
            form: "sign"
        }
    },
    "APPROETSA": {
        group: "station",
        cat: "station_distant",
        type: "FR:APPROCHE_ETS_A",
        properties: {
            form: "sign"
        }
    },
    "LIMITETS": {
        group: "station",
        cat: "station_distant",
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
            form: "light",
            states: "push;pull;stop"
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

/* ===== Private conversion helpers ===== */

/** Convert SNCF sens code to OSM direction string. */
function _osmDir(sens) {
    return { C: "forward", D: "backward", B: "both" }[sens] ?? "forward";
}

/** True when dir1 and dir2 are strictly opposite (forward ↔ backward). */
function _isOpposite(dir1, dir2) {
    return (dir1 === "forward" && dir2 === "backward") ||
        (dir1 === "backward" && dir2 === "forward");
}

/** Convert SNCF PK string "077+305" to decimal km "77.305". */
function _convertPk(raw) {
    if (!raw) return "";
    const m = raw.match(/^(\d+)\+(\d+)$/);
    if (!m) return raw;
    const km = parseInt(m[1], 10);
    const dec = m[2].padEnd(3, "0").slice(0, 3);
    return `${km}.${dec}`;
}

/** Convert SNCF position code to OSM value. */
function _convertPosition(raw) {
    return { A: "bridge", D: "right", G: "left" }[raw] ?? (raw ?? "");
}


/* ===== Node conflict resolution ===== */

/**
 * Returns true when the incoming feature can be placed in the given group
 * without producing conflicting OSM tags.
 *
 * Two signals with the SAME ORM category (cat) conflict when they face the
 * SAME direction — they would both generate the same tag key prefix, with or
 * without the :backward suffix, overwriting each other.
 *
 * Two same-cat signals facing STRICTLY OPPOSITE directions can coexist in one
 * node. Their type values may differ (e.g. FR:Z forward + FR:R backward).
 * Whether direction=both is valid is a separate concern — see _isSymmetric.
 *
 * sens=B ("both") is treated as covering all directions and therefore conflicts
 * with any other same-cat signal regardless of the other's direction.
 */
function _canFit(feat, group) {
    const e1 = _SIGNAL_MAPPING[feat.p.type_if];
    const dir1 = _osmDir(feat.p.sens);

    for (const other of group) {
        const e2 = _SIGNAL_MAPPING[other.p.type_if];
        const dir2 = _osmDir(other.p.sens);

        if (e1.cat !== e2.cat) continue;   // different category — no conflict

        // Same category: only strictly opposite directions avoid a key collision.
        if (!_isOpposite(dir1, dir2)) return false;
    }
    return true;
}

/**
 * Returns true when every signal in the group is perfectly paired: for each
 * ORM category, exactly one forward signal and one backward signal share the
 * same type value, with no unpaired signals.
 */
function _isSymmetric(group) {
    const byCat = new Map();
    for (const feat of group) {
        const e = _SIGNAL_MAPPING[feat.p.type_if];
        const dir = _osmDir(feat.p.sens);
        if (dir === "both") return false;   // sens=B would make direction=both ambiguous
        if (!byCat.has(e.cat)) byCat.set(e.cat, { fwd: null, bwd: null });
        const slot = byCat.get(e.cat);
        if (dir === "forward") slot.fwd = feat;
        else slot.bwd = feat;
    }
    for (const { fwd, bwd } of byCat.values()) {
        if (!fwd || !bwd) return false;   // unpaired signal in this category
        if (_SIGNAL_MAPPING[fwd.p.type_if].type !==
            _SIGNAL_MAPPING[bwd.p.type_if].type) return false;   // types differ
    }
    return true;
}


/* ===== OSM tag construction — step functions ===== */

/**
 * Step 1 of _buildNodeTags.
 *
 * Determine the node's railway:signal:direction value and which direction is
 * "principal" (the one that writes tags without any suffix).
 *
 *   direction=both      iff the group is perfectly symmetric (see _isSymmetric).
 *   direction=forward   when fwdCount >= bwdCount (tie breaks to forward).
 *   direction=backward  when bwdCount > fwdCount.
 *
 * The principal direction is forward in all cases except direction=backward.
 *
 * Returns { nodeDir, principal } where principal is "forward" or "backward".
 */
function _computeNodeDirection(group) {
    if (_isSymmetric(group)) return { nodeDir: "both", principal: "forward" };

    const fwdCount = group.filter(f => f.p.sens !== "D").length;
    const bwdCount = group.filter(f => f.p.sens === "D").length;
    const nodeDir = fwdCount >= bwdCount ? "forward" : "backward";
    return { nodeDir, principal: nodeDir };
}

/**
 * Step 2 of _buildNodeTags.
 *
 * Distribute every signal in the group into a per-category slot map.
 * Each category gets a "principal" slot (signal whose direction matches the
 * node's principal direction, or sens=B) and an "other" slot (the opposite).
 *
 * Map insertion order follows the feature sort order from getOsmNodes, which
 * mirrors _SIGNAL_MAPPING priority — this controls the final tag output order.
 *
 * Returns Map<cat, { principal: feat|null, other: feat|null }>.
 */
function _groupByCat(group, principal) {
    const byCat = new Map();
    for (const feat of group) {
        const e = _SIGNAL_MAPPING[feat.p.type_if];
        const dir = _osmDir(feat.p.sens);
        if (!byCat.has(e.cat)) byCat.set(e.cat, { principal: null, other: null });
        const slot = byCat.get(e.cat);
        // sens=B ("both") counts as principal — it covers all directions.
        if (dir === "both" || dir === principal) slot.principal = feat;
        else slot.other = feat;
    }
    return byCat;
}

/**
 * Step 3a — Signal present in the principal direction only (no opposite partner).
 *
 * No suffix is needed anywhere: there is no key collision risk.
 *
 *   railway:signal:<cat>           = <type>
 *   railway:signal:<cat>:<propKey> = <propVal>   (all properties)
 *   railway:signal:<cat>:ref       = <idreseau>
 */
function _writePrincipalOnlyTags(prefix, feat, tags) {
    const e = _SIGNAL_MAPPING[feat.p.type_if];
    tags.set(prefix, e.type);
    for (const [k, v] of Object.entries(e.properties || {})) {
        tags.set(`${prefix}:${k}`, v);
    }
    if (feat.p.idreseau) tags.set(`${prefix}:ref`, feat.p.idreseau);
}

/**
 * Step 3b — Signal present in the non-principal (backward) direction only,
 * with no forward partner in the same category.
 *
 * The type tag receives the :backward suffix to indicate its direction.
 * Properties and :ref do NOT receive :backward — with no forward partner there
 * is no key collision, and the :backward on the type provides sufficient
 * context for OSM consumers (this is the established ORM convention).
 *
 *   railway:signal:<cat>:backward  = <type>
 *   railway:signal:<cat>:<propKey> = <propVal>   (no suffix — no conflict)
 *   railway:signal:<cat>:ref       = <idreseau>  (no suffix — no conflict)
 */
function _writeUnpairedBackwardTags(prefix, feat, tags) {
    const e = _SIGNAL_MAPPING[feat.p.type_if];
    tags.set(`${prefix}:backward`, e.type);
    for (const [k, v] of Object.entries(e.properties || {})) {
        tags.set(`${prefix}:${k}`, v);
    }
    if (feat.p.idreseau) tags.set(`${prefix}:ref`, feat.p.idreseau);
}

/**
 * Step 3c — Two signals back-to-back in the same category (one forward, one
 * backward).  Tags are deduplicated: shared property values are written once
 * without suffix; only divergent values receive the :backward suffix.
 *
 * Forward block (no suffix):
 *   railway:signal:<cat>           = <type_fwd>
 *   railway:signal:<cat>:<propKey> = <fwdVal>    — or <bwdVal> if fwd absent
 *   railway:signal:<cat>:ref       = <idreseau_fwd>
 *
 * Backward block (:backward suffix applied selectively):
 *   railway:signal:<cat>:backward           = <type_bwd>   always written,
 *                                             even when identical to type_fwd
 *   railway:signal:<cat>:<propKey>:backward = <bwdVal>     only when ≠ fwdVal
 *   railway:signal:<cat>:ref:backward       = <idreseau_bwd>  always written
 *                                             (idreseau values are always distinct)
 */
function _writePairedTags(prefix, pFeat, oFeat, tags) {
    const pEntry = _SIGNAL_MAPPING[pFeat.p.type_if];
    const oEntry = _SIGNAL_MAPPING[oFeat.p.type_if];
    const pProps = pEntry.properties || {};
    const oProps = oEntry.properties || {};
    const allPropKeys = new Set([...Object.keys(pProps), ...Object.keys(oProps)]);

    // Forward block -----
    tags.set(prefix, pEntry.type);

    // Unified property set: for each key present in either direction, write
    // the forward value without suffix. If the key only exists in the backward
    // signal, write the backward value without suffix (no fwd key to collide).
    for (const k of allPropKeys) {
        tags.set(`${prefix}:${k}`, pProps[k] !== undefined ? pProps[k] : oProps[k]);
    }

    if (pFeat.p.idreseau) tags.set(`${prefix}:ref`, pFeat.p.idreseau);

    // Backward block -----
    // Type is always written even when identical to the forward type: it marks
    // the presence of a second physical signal facing the opposite direction.
    tags.set(`${prefix}:backward`, oEntry.type);

    // Only properties whose backward value DIFFERS from the forward value need
    // the :backward suffix; identical values are already covered by the forward
    // block above and repeating them would be redundant.
    for (const k of allPropKeys) {
        if (oProps[k] !== undefined && oProps[k] !== pProps[k]) {
            tags.set(`${prefix}:${k}:backward`, oProps[k]);
        }
    }

    // Ref is always written with :backward suffix — idreseau values are always
    // distinct between two physical signals even of the same type.
    if (oFeat.p.idreseau) tags.set(`${prefix}:ref:backward`, oFeat.p.idreseau);
}

/**
 * Build the complete OSM tag Map for one node group.
 *
 * Orchestrates the four steps defined above:
 *   1. _computeNodeDirection — derive nodeDir and the principal direction
 *   2. _groupByCat           — assign each signal to a per-category slot
 *   3. Write common node header tags
 *   4. Per-category: dispatch to the appropriate tag-writer based on slot fill:
 *        principal slot only  → _writePrincipalOnlyTags    (step 3a)
 *        other slot only      → _writeUnpairedBackwardTags  (step 3b)
 *        both slots filled    → _writePairedTags            (step 3c)
 *   5. Append source=SNCF - 03/2022 as the final tag
 */
function _buildNodeTags(group) {
    const { nodeDir, principal } = _computeNodeDirection(group);
    const byCat = _groupByCat(group, principal);

    const tags = new Map();

    // Common node header -----
    tags.set("railway", "signal");
    tags.set("railway:position:exact", _convertPk(group[0].p.pk));
    tags.set("railway:signal:direction", nodeDir);
    tags.set("railway:signal:position", _convertPosition(group[0].p.position));

    // Per-category signal tags -----
    for (const [cat, { principal: pFeat, other: oFeat }] of byCat) {
        const prefix = `railway:signal:${cat}`;
        if (pFeat && !oFeat) _writePrincipalOnlyTags(prefix, pFeat, tags);
        else if (!pFeat && oFeat) _writeUnpairedBackwardTags(prefix, oFeat, tags);
        else if (pFeat && oFeat) _writePairedTags(prefix, pFeat, oFeat, tags);
    }

    // Mandatory closing tag -----
    tags.set("source", "SNCF - 03/2022");

    return tags;
}

/* ===== Public query functions ===== */

/** Return the display category key for any type_if. */
export function getTypeCategory(type_if) {
    return _SIGNAL_MAPPING[type_if]?.group ?? "unsupported";
}

/** Return the display colour for any type_if. */
export function getTypeColor(type_if) {
    return _CATEGORY_INFO[getTypeCategory(type_if)];
}

/** Return true when this type_if has an OSM mapping. */
export function isSupported(type_if) {
    return !!_SIGNAL_MAPPING[type_if];
}

/**
 * Return the OSM :ref tag key for a given type_if, or null if unsupported.
 * Example: "CARRE" -> "railway:signal:main:ref"
 *
 * A signal's idreseau can appear in OSM under either the forward ref key
 * (this function) or the backward ref key (getBackwardSignalId), regardless
 * of direction=both. overpass.js always queries both in a single request.
 */
export function getSignalId(type_if) {
    const entry = _SIGNAL_MAPPING[type_if];
    return entry ? `railway:signal:${entry.cat}:ref` : null;
}

/**
 * Return the OSM :ref:backward tag key for a given type_if, or null if unsupported.
 * Example: "CARRE" -> "railway:signal:main:ref:backward"
 *
 * Used by overpass.js to detect signals already recorded as the backward
 * member of a back-to-back pair on an existing OSM node.
 */
export function getBackwardSignalId(type_if) {
    const entry = _SIGNAL_MAPPING[type_if];
    return entry ? `railway:signal:${entry.cat}:ref:backward` : null;
}

/** Set of all type_if values that have a mapping. Exported for filters.js. */
const _supportedTypes = new Set(Object.keys(_SIGNAL_MAPPING));
export function getSupportedTypes() { return _supportedTypes; }


/* ===== Legend ===== */

/**
 * Populate #legend-body with one colour row per _CATEGORY_INFO entry.
 * Called once from app.js; safe to call again on language change.
 */
export function buildLegend() {
    const container = document.getElementById("legend-body");
    const tpl = document.getElementById("tpl-legend-row");
    if (!container || !tpl) return;

    container.replaceChildren();

    for (const [key, color] of Object.entries(_CATEGORY_INFO)) {
        const row = tpl.content.cloneNode(true).querySelector(".panel-row");
        row.querySelector(".legend-dot").style.backgroundColor = color;
        row.querySelector(".legend-label").dataset.i18n = `cat.${key}`;
        container.appendChild(row);
    }
}


/* ===== OSM node computation ===== */

/**
 * Returns the first 4 digits of an idreseau string as a cluster key.
 * Signals with the same 4-digit prefix are considered numerically related
 * and are sorted together before the node-grouping pass.
 * Signals without an idreseau use an empty string so they sort last.
 */
function _idrCluster(idreseau) {
    return idreseau ? String(idreseau).slice(0, 4) : '';
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
    const priority = Object.keys(_SIGNAL_MAPPING);
    const supported = feats.filter(f => isSupported(f.p.type_if));

    if (!supported.length) return { nodes: [], featToNodeIdx: new Map() };

    // Sort so signals with similar idreseau prefixes are processed consecutively.
    // This increases the chance that numerically close signals (e.g. 94560-94563)
    // share a node when their cats allow it, while unrelated clusters (e.g. 118480+)
    // naturally go to separate nodes. Within a cluster, _SIGNAL_MAPPING priority
    // order is preserved so higher-priority types still claim the best node first.
    supported.sort((a, b) => {
        const clA = _idrCluster(a.p.idreseau);
        const clB = _idrCluster(b.p.idreseau);
        if (clA !== clB) return clA < clB ? -1 : 1;
        return priority.indexOf(a.p.type_if) - priority.indexOf(b.p.type_if);
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
        const id = group.map(f => f.p.idreseau || f.p.type_if).sort().join('|');
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

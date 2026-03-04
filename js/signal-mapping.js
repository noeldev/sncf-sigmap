/**
 * signal-mapping.js
 * SNCF type_if -> display category + OpenRailwayMap tags.
 *
 * Each entry in SIGNAL_MAPPING has:
 *   group  — one of the application display categories (for colour and legend)
 *   tags   — array of "key=value" OSM tag strings, following the ORM wiki exactly
 *
 * Placeholders resolved at runtime:
 *   {{pk}}       -> railway:position:exact  (e.g. 077+305 -> 77.305)
 *   {{sens}}     -> railway:signal:direction (C->forward, D->backward, B->both)
 *   {{position}} -> railway:signal:position  (A->bridge, D->right, G->left)
 *   {{idreseau}} -> SNCF internal network ID (verbatim)
 *
 * Common tags added automatically to every node (not repeated here):
 *   railway=signal
 *   railway:position:exact={{pk}}
 *   railway:signal:direction={{sens}}
 *   railway:signal:position={{position}}
 *   source=SNCF - 03/2022
 *
 * Reference: https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

// Application-level categories coarser than ORM tag categories.
// Only used for marker colours and the legend; ORM tags are independent.

export const CATEGORY_INFO = {
    "main":             "#e00000",   // Main signals (carré, S, GA, …)
    "stop":             "#b09000",   // Stop signals
    "distant":          "#ffc010",   // Distant signals (A, D)
    "speed_limit":      "#f88000",   // All speed_limit* variants
    "route":            "#00b0d0",   // Route* (ID, IDD, CHEVRON, …)
    "train_protection": "#4060c0",   // Cab signalling / ETCS
    "crossing":         "#d04020",   // Level crossings
    "wrong_road":       "#00a0a0",   // Contre-sens
    "shunting":         "#a050e0",   // Shunting
    "electricity":      "#a00060",   // Traction electricity
    "station":          "#008040",   // Station and facility signals (approche, SLD, …)
    "miscellaneous":    "#607070",   // Gabarit, whistle, …
    "unsupported":      "#a0b0c0",   // Types not yet mapped
};

// Each entry defines both the display category (group) and the OSM tags (tags).
// Types not listed here are considered "unsupported" (grey on map, no JOSM export).

export const SIGNAL_MAPPING = {

    // Main signals

    "CARRE": {
        group: "main",
        tags: [
            "railway:signal:main=FR:CARRE",
            "railway:signal:main:form=light",
            "railway:signal:main:states=FR:C;FR:VL",
            "railway:signal:main:ref={{idreseau}}",
        ],
    },
    "R30": {
        group: "main",
        tags: [
            "railway:signal:main=FR:CARRE",
            "railway:signal:main:form=light",
            "railway:signal:main:shape=FR:F",
            "railway:signal:main:states=FR:C;FR:VL;FR:R",
            "railway:signal:main:ref={{idreseau}}",
        ],
    },
    "RR30": {
        group: "main",
        tags: [
            "railway:signal:main=FR:CARRE",
            "railway:signal:main:form=light",
            "railway:signal:main:shape=FR:H",
            "railway:signal:main:states=FR:C;FR:VL;FR:RR",
            "railway:signal:main:ref={{idreseau}}",
        ],
    },
    "CV": {
        group: "main",
        tags: [
            "railway:signal:main=FR:CV",
            "railway:signal:main:form=light",
            "railway:signal:main:states=FR:CV;FR:M",
            "railway:signal:main:ref={{idreseau}}",
        ],
    },
    "S": {
        group: "main",
        tags: [
            "railway:signal:main=FR:S",
            "railway:signal:main:form=light",
            "railway:signal:main:states=FR:S;FR:VL",
            "railway:signal:main:ref={{idreseau}}",
        ],
    },
    "GA": {
        group: "main",
        tags: [
            "railway:signal:main=FR:GA",
            "railway:signal:main:form=light",
            "railway:signal:main:ref={{idreseau}}",
        ],
    },

    // TODO "FEUXVERTS" is this a Carré?

    // Distant

    "CARRE A": {
        group: "distant",
        tags: [
            "railway:signal:distant=FR:CARRE_A",
            "railway:signal:distant:form=sign",
            "railway:signal:distant:ref={{idreseau}}",
        ],
    },
    "A": {
        group: "distant",
        tags: [
            "railway:signal:distant=FR:A",
            "railway:signal:distant:form=light",
            "railway:signal:distant:states=FR:A;FR:VL",
            "railway:signal:distant:ref={{idreseau}}",
        ],
    },
    "D": {
        group: "distant",
        tags: [
            "railway:signal:distant=FR:D",
            "railway:signal:distant:form=light",
            "railway:signal:distant:states=FR:D;FR:A;FR:VL",
            "railway:signal:distant:ref={{idreseau}}",
        ],
    },

    // Speed limits

    "TIV D MOB": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit_distant=FR:TIV-D_MOB",
            "railway:signal:speed_limit_distant:form=light",
            "railway:signal:speed_limit_distant:ref={{idreseau}}",
        ],
    },
    "TIV R MOB": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit_reminder=FR:TIV-R_MOB",
            "railway:signal:speed_limit_reminder:form=light",
            "railway:signal:speed_limit_reminder:ref={{idreseau}}",
        ],
    },
    "TIV D FIXE": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit_distant=FR:TIV-D_FIXE",
            "railway:signal:speed_limit_distant:form=sign",
            "railway:signal:speed_limit_distant:shape=square",
            "railway:signal:speed_limit_distant:ref={{idreseau}}",
        ],
    },
    "TIVD B FIX": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit_distant=FR:TIV-D_B_FIXE",
            "railway:signal:speed_limit_distant:type=FR:B",
            "railway:signal:speed_limit_distant:form=sign",
            "railway:signal:speed_limit_distant:ref={{idreseau}}",
        ],
    },
    "TIVD C FIX": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit_distant=FR:TIV-D_C_FIXE",
            "railway:signal:speed_limit_distant:type=FR:C",
            "railway:signal:speed_limit_distant:form=sign",
            "railway:signal:speed_limit_distant:ref={{idreseau}}",
        ],
    },
    "P": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit=FR:P",
            "railway:signal:speed_limit:form=sign",
            "railway:signal:speed_limit:ref={{idreseau}}",
        ],
    },
    "Z": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit=FR:Z",
            "railway:signal:speed_limit:form=sign",
            "railway:signal:speed_limit:function=entry",
            "railway:signal:speed_limit:ref={{idreseau}}",
        ],
    },
    "R": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit=FR:R",
            "railway:signal:speed_limit:form=sign",
            "railway:signal:speed_limit:function=exit",
            "railway:signal:speed_limit:ref={{idreseau}}",
        ],
    },
    "CHEVRON": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit=FR:CHEVRON_BAS",
            "railway:signal:speed_limit:type=downwards",
            "railway:signal:speed_limit:form=sign",
            "railway:signal:speed_limit:ref={{idreseau}}",
        ],
    },
    "TIV PENDIS": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit_distant=FR:TIV-PENDIS",
            "railway:signal:speed_limit_distant:form=sign",
            "railway:signal:speed_limit_distant:ref={{idreseau}}",
        ],
    },
    "TIV PENEXE": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit=FR:TIV-PENEXE",
            "railway:signal:speed_limit:form=sign",
            "railway:signal:speed_limit:function=entry",
            "railway:signal:speed_limit:ref={{idreseau}}",
        ],
    },
    "TIV PENREP": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit=FR:TIV-PENREP",
            "railway:signal:speed_limit:form=sign",
            "railway:signal:speed_limit:function=exit",
            "railway:signal:speed_limit:speed=none",
            "railway:signal:speed_limit:ref={{idreseau}}",
        ],
    },
    "REPER VIT": {
        group: "speed_limit",
        tags: [
            "railway:signal:speed_limit=FR:REP_VITESSE",
            "railway:signal:speed_limit:form=sign",
            "railway:signal:speed_limit:function=entry",
            "railway:signal:speed_limit:ref={{idreseau}}",
        ],
    },

    // Route

    "ID": {
        group: "route",
        tags: [
            "railway:signal:route=FR:ID",
            "railway:signal:route:form=light",
            "railway:signal:route:ref={{idreseau}}",
        ],
    },
    "IDD": {
        group: "route",
        tags: [
            "railway:signal:route_distant=FR:TIDD",
            "railway:signal:route_distant:form=light",
            "railway:signal:route_distant:ref={{idreseau}}",
        ],
    },
    "TLD": {
        group: "route",
        tags: [
            "railway:signal:route_distant=FR:TLD",
            "railway:signal:route_distant:form=light",
            "railway:signal:route_distant:ref={{idreseau}}",
        ],
    },
/*
    "BIF": {
        group: "route",
        tags: [
            "railway:signal:route_distant=FR:BIF",
            "railway:signal:route_distant:form=sign",
            "railway:signal:route_distant:ref={{idreseau}}",
        ],
    },
    "Y": {
        group: "route",
        tags: [
            "railway:signal:route_distant=FR:Y",
            "railway:signal:route_distant:form=sign",
            "railway:signal:route_distant:ref={{idreseau}}",
        ],
    },
*/
    // Stop signals

    "ARRET VOY": {
        group: "stop",
        tags: [
            "railway:signal:stop=FR:ARRET_TT",
            "railway:signal:stop:form=sign",
            "railway:signal:stop:ref={{idreseau}}",
        ],
    },

    // Level crossings

    "PN...": {
        group: "crossing",
        tags: [
            "railway:signal:crossing_hint=FR:PN_A",
            "railway:signal:crossing_hint:form=sign",
            "railway:signal:crossing_hint:ref={{idreseau}}",
        ],
    },
    "PN": {
        group: "crossing",
        tags: [
            "railway:signal:crossing_info=FR:PN",
            "railway:signal:crossing_info:form=sign",
            "railway:signal:crossing_info:ref={{idreseau}}",
        ],
    },

    // Electricity

    "SECT": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:SECT",
            "railway:signal:electricity:type=power_off_advance",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "CC EXE": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:CC_EXE",
            "railway:signal:electricity:type=power_off",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:function=entry",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "CC FIN": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:CC_FIN",
            "railway:signal:electricity:type=power_on",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:function=exit",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "REV": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:REV",
            "railway:signal:electricity:type=power_on",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:function=exit",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "BP DIS": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:BP_DIS",
            "railway:signal:electricity:type=pantograph_down_advance",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "BP EXE": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:BP_EXE",
            "railway:signal:electricity:type=pantograph_down",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:function=entry",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "BP FIN": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:BP_FIN",
            "railway:signal:electricity:type=pantograph_up",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:function=exit",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "FIN CAT": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:FIN_CAT",
            "railway:signal:electricity:type=end_of_catenary",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "GIVRE": {
        group: "electricity",
        tags: [
            "railway:signal:electricity=FR:GIVRE",
            "railway:signal:electricity:form=sign",
            "railway:signal:electricity:ref={{idreseau}}",
        ],
    },
    "BIMODE A": {
        group: "electricity",
        tags: [
            "railway:signal:dual_mode=FR:BIMODE_A",
            "railway:signal:dual_mode:form=sign",
            "railway:signal:dual_mode:function=entry",
            "railway:signal:dual_mode:ref={{idreseau}}",
        ],
    },
    "BIMODE": {
        group: "electricity",
        tags: [
            "railway:signal:dual_mode=FR:BIMODE",
            "railway:signal:dual_mode:form=sign",
            "railway:signal:dual_mode:function=exit",
            "railway:signal:dual_mode:ref={{idreseau}}",
        ],
    },

    // Cab signalling / Train protection

    "CAB E": {
        group: "train_protection",
        tags: [
            "railway:signal:train_protection=FR:CAB_E",
            "railway:signal:train_protection:form=sign",
            "railway:signal:train_protection:ref={{idreseau}}",
        ],
    },
    "CAB R": {
        group: "train_protection",
        tags: [
            "railway:signal:train_protection=FR:CAB_E",
            "railway:signal:train_protection:form=sign",
            "railway:signal:train_protection:function=entry",
            "railway:signal:train_protection:ref={{idreseau}}",
        ],
    },
    "CAB S": {
        group: "train_protection",
        tags: [
            "railway:signal:train_protection=FR:CAB_S",
            "railway:signal:train_protection:form=sign",
            "railway:signal:train_protection:function=exit",
            "railway:signal:train_protection:ref={{idreseau}}",
        ],
    },

    // Markers

    "REP TVM": {
        group: "train_protection",
        tags: [
            "railway:signal:train_protection=FR:REP_TVM",
            "railway:signal:train_protection:form=sign",
            "railway:signal:train_protection:function=block_marker",
            "railway:signal:train_protection:ref={{idreseau}}",
        ],
    },
    "REP TGV": {
        group: "train_protection",
        tags: [
            "railway:signal:train_protection=FR:REP_ETCS",
            "railway:signal:train_protection:form=sign",
            "railway:signal:train_protection:function=stop_marker",
            "railway:signal:train_protection:ref={{idreseau}}",
        ],
    },

    // Wrong roads

    "TECS": {
        group: "wrong_road",
        tags: [
            "railway:signal:wrong_road=FR:TECS",
            "railway:signal:wrong_road:form=light",
            "railway:signal:wrong_road:function=entry",
            "railway:signal:wrong_road:ref={{idreseau}}",
        ],
    },
    "TSCS": {
        group: "wrong_road",
        tags: [
            "railway:signal:wrong_road=FR:TSCS",
            "railway:signal:wrong_road:form=light",
            "railway:signal:wrong_road:function=exit",
            "railway:signal:wrong_road:ref={{idreseau}}",
        ],
    },

    // Stop
    "ARRET A": {
        group: "stop",
        tags: [
            "railway:signal:stop_distant=FR:ARRET_A",
            "railway:signal:stop_distant:form=sign",
            "railway:signal:stop_distant:ref={{idreseau}}",
        ],
    },
    "ARRET": {
        group: "stop",
        tags: [
            "railway:signal:stop=FR:ARRET",
            "railway:signal:stop:form=sign",
            "railway:signal:stop:ref={{idreseau}}",
        ],
    },
    "ATC": {
        group: "stop",
        tags: [
            "railway:signal:stop=FR:ATC",
            "railway:signal:stop:form=sign",
            "railway:signal:stop:ref={{idreseau}}",
        ],
    },
    "GARE": {
        group: "stop",
        tags: [
            "railway:signal:stop=FR:GARE",
            "railway:signal:stop:form=sign",
            "railway:signal:stop:ref={{idreseau}}",
        ],
    },
    "JAL ARRET": {
        group: "stop",
        tags: [
            "railway:signal:stop=FR:JAL_ARRET",
            "railway:signal:stop:form=sign",
            "railway:signal:stop:ref={{idreseau}}",
        ],
    },
    "STOP": {
        group: "stop",
        tags: [
            "railway:signal:stop=FR:STOP",
            "railway:signal:stop:form=sign",
            "railway:signal:stop:ref={{idreseau}}",
        ],
    },
    // Stations and facilities

    "APPROCHETS": {
        group: "station",
        tags: [
            "railway:signal:station_distant=FR:APPROCHE_ETS",
            "railway:signal:station_distant:form=sign",
            "railway:signal:station_distant:ref={{idreseau}}",
        ],
    },
    "APPROETSA": {
        group: "station",
        tags: [
            "railway:signal:station_distant=FR:APPROCHE_ETS_A",
            "railway:signal:station_distant:form=sign",
            "railway:signal:station_distant:ref={{idreseau}}",
        ],
    },
    "LIMITETS": {
        group: "station",
        tags: [
            "railway:signal:station_distant=FR:LIMITE_ETS",
            "railway:signal:station_distant:form=sign",
            "railway:signal:station_distant:ref={{idreseau}}",
        ],
    },
    "SLD": {
        group: "station",
        tags: [
            "railway:signal:departure=FR:SLD",
            "railway:signal:departure:form=light",
            "railway:signal:departure:ref={{idreseau}}",
        ],
    },

    // Shunting

    "IDP": {
        group: "shunting",
        tags: [
            "railway:signal:shunting=FR:TIP",
            "railway:signal:shunting:form=light",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },
    "JAL MAN": {
        group: "shunting",
        tags: [
            "railway:signal:shunting=FR:JAL_MAN",
            "railway:signal:shunting:form=sign",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },
    "DEPOT": {
        group: "shunting",
        tags: [
            "railway:signal:shunting=FR:DEPOT",
            "railway:signal:shunting:form=sign",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },
    "G": {
        group: "shunting",
        tags: [
            "railway:signal:shunting=FR:G",
            "railway:signal:shunting:form=sign",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },
    "IMP": {
        group: "shunting",
        tags: [
            "railway:signal:shunting=FR:IMP",
            "railway:signal:shunting:form=sign",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },
    "LGR": {
        group: "shunting",
        tags: [
            "railway:signal:shunting=FR:LGR",
            "railway:signal:shunting:form=sign",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },
    "LM": {
        group: "shunting",
        tags: [
            "railway:signal:shunting=FR:LM",
            "railway:signal:shunting:form=sign",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },
    "MV": {
        group: "shunting",
        tags: [
            "railway:signal:shunting=FR:MV",
            "railway:signal:shunting:form=sign",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },
    "HEURT...": {
        group: "shunting",
        tags: [
            "railway=buffer_stop",
            "railway:signal:shunting=FR:HEURTOIR",
            "railway:signal:shunting:type=buffer_stop",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },

    "SLM": {
        group: "shunting",
        tags: [
            "railway=buffer_stop",
            "railway:signal:shunting=FR:HEURTOIR",
            "railway:signal:shunting:type=buffer_stop",
            "railway:signal:shunting:ref={{idreseau}}",
        ],
    },

    // Miscellaneous

    "GABARIT": {
        group: "miscellaneous",
        tags: [
            "railway:signal:main=FR:GABARIT",
            "railway:signal:main:form=sign",
            "railway:signal:main:ref={{idreseau}}",
        ],
    },
    "SIFFLER": {
        group: "miscellaneous",
        tags: [
            "railway:signal:whistle=FR:SIFFLER",
            "railway:signal:whistle:form=sign",
            "railway:signal:whistle:ref={{idreseau}}",
        ],
    },
};

/** Return the display category for any type_if. */
export function getTypeCategory(type_if) {
    return SIGNAL_MAPPING[type_if]?.group || "unsupported";
}

/** Return the display colour for any type_if. */
export function getTypeColor(type_if) {
    return CATEGORY_INFO[getTypeCategory(type_if)];
}

/** Return true if OSM tags are defined and non-empty for this type_if. */
export function isSupported(type_if) {
    return (SIGNAL_MAPPING[type_if]?.tags?.length ?? 0) > 0;
}

// The :ref tag used in OSM for each type_if (for Overpass existence checks)
// Derived from the last :ref tag in each entry's tags array.

export const TYPE_REF_TAG = (() => {
    const map = {};
    for (const [type, entry] of Object.entries(SIGNAL_MAPPING)) {
        const refTag = entry.tags.find(t => t.endsWith(":ref={{idreseau}}"));
        if (refTag) map[type] = refTag.split("=")[0];  // key only, e.g. "railway:signal:main:ref"
    }
    return map;
})();

// ===== Field value converters for {{placeholder}} resolution =====

export const FIELD_CONVERTERS = {

    // "077+305" -> "77.305"
    pk: (raw) => {
        if (!raw) return raw;
        const m = raw.match(/^(\d+)\+(\d+)$/);
        if (!m) return raw;
        const km = parseInt(m[1], 10);
        const dec = m[2].padEnd(3, "0").slice(0, 3);
        return `${km}.${dec}`;
    },

    // C -> forward, D -> backward, B -> both
    sens: (raw) => ({ C: "forward", D: "backward", B: "both" }[raw] || raw),

    // A -> bridge, D -> right, G -> left
    position: (raw) => ({ A: "bridge", D: "right", G: "left" }[raw] || raw),
};

// Tags shared across all signals in a co-located group (emitted once per node).
export const COMMON_TAGS = [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "source=SNCF - 03/2022",
];

/**
 * signal-mapping.js
 * SNCF type_if -> OpenRailwayMap tag mapping.
 *
 * Each key maps to an array of "key=value" tag strings.
 * Placeholders resolved at runtime:
 *   {{pk}}       -> railway:position:exact  (e.g. 077+305 -> 77.305)
 *   {{sens}}     -> railway:signal:direction (C->forward, D->backward, B->both)
 *   {{position}} -> railway:signal:position  (A->bridge, D->right, G->left)
 *   {{idreseau}} -> SNCF internal network ID (verbatim)
 *
 * The following tags are common to all nodes and added automatically
 * (do not include them here):
 *   railway=signal
 *   railway:position:exact={{pk}}
 *   railway:signal:direction={{sens}}
 *   railway:signal:position={{position}}
 *   source=SNCF - 03/2022
 *
 * ORM signal categories: main, distant, shunting, crossing_info, electricity,
 *   speed_limit, speed_limit_distant, speed_limit_reminder, whistle, route,
 *   route_distant, wrong_road, stop, station_distant, train_protection, departure
 *
 * Reference: https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

// ===== Display categories -> colour =====
// These are the application-level display categories shown in the legend and on markers.
// They deliberately group ORM signal categories for readability (e.g. all speed_limit*
// variants share one colour). ORM tag categories in SIGNAL_MAPPING are not affected.

export const CATEGORY_COLORS = {
    "main":          "#e85d5d",   // red    — main signals (carré, S, GA, …)
    "distant":       "#f5c842",   // yellow — distant / approach (A, D, …)
    "speed_limit":   "#fb923c",   // orange — all speed_limit* variants
    "route":         "#38bdf8",   // sky blue — route* (ID, IDD, CHEVRON, …)
    "stop":          "#60a5fa",   // blue   — stop (arrêt voyageurs, GA, …)
    "shunting":      "#a78bfa",   // violet — shunting / manœuvres
    "crossing":      "#4ade80",   // green  — crossing* (PN, …)
    "electricity":   "#e879f9",   // magenta — traction electricity
    "train_protection": "#f43f5e", // rose  — cab signalling / ETCS
    "wrong_road":    "#ef4444",   // red    — contre-sens (TECS, TSCS)
    "station":       "#64748b",   // grey-blue — station / stop approach
    "miscellaneous": "#94a3b8",   // slate  — departure, whistle, gabarit, …
    "unsupported":   "#4b5563",   // dark grey — types not yet mapped
};

// ===== type_if -> ORM category =====
// Sources: SIGNAL_MAPPING entries + PDF mapping table.
// Used for marker colour and legend.

export const SIGNAL_TYPE_CATEGORY = {
    // Main signals
    "CARRE":        "main",
    "S":            "main",
    "GA":           "main",
    "R30":          "main",
    "RR30":         "main",

    // CV is a shunting signal (carré violet = violet square)
    "CV":           "main",

    // Distant signals
    "A":            "distant",
    "D":            "distant",
    "CARRE A":      "distant",

    // Speed limit (execution)
    "Z":            "speed_limit",
    "R":            "speed_limit",
    "TIV PENEXE":   "speed_limit",
    "TIV PENREP":   "speed_limit",
    "TIVD B FIX":   "speed_limit",
    "TIVD C FIX":   "speed_limit",

    // Speed limit (reminder)
    "TIV R MOB":    "speed_limit_reminder",

    // Speed limit (advance / distant)
    "TIV D FIXE":   "speed_limit_distant",
    "TIV D MOB":    "speed_limit_distant",
    "TIV PENDIS":   "speed_limit_distant",
    "P":            "speed_limit_distant",

    // Route
    "ID":           "route",
    "CHEVRON":      "route",

    // Route distant
    "IDD":          "route_distant",
    "IDP":          "route_distant",
    "TLD":          "route_distant",

    // Stop
    "ARRET VOY":    "stop",
    "ARRET":        "stop",
    "STOP":         "stop",
    "ATC":          "stop",
    "GA_STOP":      "stop",
    "JAL ARRET":    "stop",

    // Shunting
    "HEURTOIR":     "shunting",
    "DEPOT":        "shunting",
    "G":            "shunting",
    "IMP":          "shunting",
    "JAL MAN":      "shunting",
    "LGR":          "shunting",
    "LM":           "shunting",
    "MV":           "shunting",
    "SLM":          "shunting",

    // Crossing
    "PN":           "crossing_info",
    "PN...":        "crossing_info",

    // Electricity / traction
    "BP DIS":       "electricity",
    "BP EXE":       "electricity",
    "BP FIN":       "electricity",
    "CC EXE":       "electricity",
    "CC FIN":       "electricity",
    "REV":          "electricity",
    "SECT":         "electricity",
    "GIVRE":        "electricity",
    "FIN CAT":      "electricity",
    "BIMODE":       "electricity",
    "BIMODE A":     "electricity",

    // Cab signalling / train protection
    "CAB E":        "train_protection",
    "CAB R":        "train_protection",
    "CAB S":        "train_protection",

    // Wrong road
    "TECS":         "wrong_road",
    "TSCS":         "wrong_road",

    // Departure
    "DD":           "departure",
    "MIBLAN VER":   "departure",
    "SLD":          "departure",

    // Whistle
    "SIFFLER":      "whistle",

    // Station / stop approach
    "APPROCHETS":   "station_distant",
    "APPROETSA":    "station_distant",
    "ARRET A":      "station_distant",
    "GARE":         "station_distant",
};

export function getTypeCategory(type_if) {
    return SIGNAL_TYPE_CATEGORY[type_if] || "unsupported";
}

export function getTypeColor(type_if) {
    return CATEGORY_COLORS[getTypeCategory(type_if)];
}

// ===== OSM tag mapping (supported types only) =====

export const SIGNAL_MAPPING = {

    // Main signals

    "CARRE": [
        "railway:signal:main=FR:CARRE",
        "railway:signal:main:form=light",
        "railway:signal:main:states=FR:C;FR:VL",
        "railway:signal:main:ref={{idreseau}}",
    ],

    "CV": [
        "railway:signal:main=FR:CV",
        "railway:signal:main:form=light",
        "railway:signal:main:states=FR:CV;FR:M",
        "railway:signal:main:ref={{idreseau}}",
    ],

    "S": [
        "railway:signal:main=FR:S",
        "railway:signal:main:form=light",
        "railway:signal:main:states=FR:S;FR:VL",
        "railway:signal:main:ref={{idreseau}}",
    ],

    "GA": [
        "railway:signal:main=FR:GA",
        "railway:signal:main:form=light",
        "railway:signal:main:ref={{idreseau}}",
    ],

    // Distant signals

    "A": [
        "railway:signal:distant=FR:A",
        "railway:signal:distant:form=light",
        "railway:signal:distant:states=FR:A;FR:VL",
        "railway:signal:distant:ref={{idreseau}}",
    ],

    "D": [
        "railway:signal:distant=FR:D",
        "railway:signal:distant:form=light",
        "railway:signal:distant:states=FR:D;FR:A;FR:VL",
        "railway:signal:distant:ref={{idreseau}}",
    ],

    // Speed limit signals (TIV)

    "TIV D FIXE": [
        "railway:signal:speed_limit_distant=FR:TIV-D_FIXE",
        "railway:signal:speed_limit_distant:form=sign",
        "railway:signal:speed_limit_distant:shape=square",
        "railway:signal:speed_limit_distant:speed=100",
        "railway:signal:speed_limit_distant:ref={{idreseau}}",
    ],

    "TIV D MOB": [
        "railway:signal:speed_limit_distant=FR:TIV-D_MOB",
        "railway:signal:speed_limit_distant:form=light",
        "railway:signal:speed_limit_distant:speed=40",
        "railway:signal:speed_limit_distant:ref={{idreseau}}",
    ],

    "TIV R MOB": [
        "railway:signal:speed_limit_reminder=FR:TIV-R_MOB",
        "railway:signal:speed_limit_reminder:form=light",
        "railway:signal:speed_limit_reminder:speed=40",
        "railway:signal:speed_limit_reminder:ref={{idreseau}}",
    ],

    "TIV PENDIS": [
        "railway:signal:speed_limit_distant=FR:TIV-PENDIS",
        "railway:signal:speed_limit_distant:form=sign",
        "railway:signal:speed_limit_distant:speed=60",
        "railway:signal:speed_limit_distant:ref={{idreseau}}",
    ],

    "TIV PENEXE": [
        "railway:signal:speed_limit=FR:TIV-PENEXE",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=entry",
        "railway:signal:speed_limit:speed=60",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    "TIV PENREP": [
        "railway:signal:speed_limit=FR:TIV-PENREP",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=exit",
        "railway:signal:speed_limit:speed=none",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    "TIVD B FIX": [
        "railway:signal:speed_limit_distant=FR:TIV-D_B_FIXE",
        "railway:signal:speed_limit_distant:form=sign",
        "railway:signal:speed_limit_distant:shape=square",
        "railway:signal:speed_limit_distant:ref={{idreseau}}",
    ],

    "TIVD C FIX": [
        "railway:signal:speed_limit_distant=FR:TIV-D_C_FIXE",
        "railway:signal:speed_limit_distant:form=sign",
        "railway:signal:speed_limit_distant:shape=square",
        "railway:signal:speed_limit_distant:ref={{idreseau}}",
    ],

    // Speed restriction markers

    "Z": [
        "railway:signal:speed_limit=FR:Z",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=entry",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    "R": [
        "railway:signal:speed_limit=FR:R",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=exit",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    // Route signals

    "CHEVRON": [
        "railway:signal:route=FR:CHEVRON_BAS",
        "railway:signal:route:form=sign",
        "railway:signal:route:ref={{idreseau}}",
    ],

    "ID": [
        "railway:signal:route=FR:ID",
        "railway:signal:route:form=light",
        "railway:signal:route:states=FR:ID1;FR:ID2",
        "railway:signal:route:ref={{idreseau}}",
    ],

    "IDD": [
        "railway:signal:route_distant=FR:TIDD",
        "railway:signal:route_distant:form=light",
        "railway:signal:route_distant:states=off;left;right",
        "railway:signal:route_distant:ref={{idreseau}}",
    ],

    // Stop markers

    "ARRET VOY": [
        "railway:signal:stop=FR:ARRET_TT",
        "railway:signal:stop:form=sign",
        "railway:signal:stop:ref={{idreseau}}",
    ],

    "HEURTOIR": [
        "railway=buffer_stop",
        "railway:signal:shunting=FR:HEURTOIR",
        "railway:signal:shunting:type=buffer_stop",
        "railway:signal:shunting:ref={{idreseau}}",
    ],

    // Level crossing

    "PN": [
        "railway:signal:crossing_info=FR:PN",
        "railway:signal:crossing_info:form=sign",
        "railway:signal:crossing_info:ref={{idreseau}}",
    ],

    // Electricity / traction

    "BP DIS": [
        "railway:signal:electricity=FR:BP_DIS",
        "railway:signal:electricity:ref={{idreseau}}",
    ],

    "BP EXE": [
        "railway:signal:electricity=FR:BP_EXE",
        "railway:signal:electricity:function=entry",
        "railway:signal:electricity:ref={{idreseau}}",
    ],

    "BP FIN": [
        "railway:signal:electricity=FR:BP_FIN",
        "railway:signal:electricity:function=exit",
        "railway:signal:electricity:ref={{idreseau}}",
    ],

    "CC EXE": [
        "railway:signal:electricity=FR:CC_EXE",
        "railway:signal:electricity:function=entry",
        "railway:signal:electricity:ref={{idreseau}}",
    ],

    "CC FIN": [
        "railway:signal:electricity=FR:CC_FIN",
        "railway:signal:electricity:function=exit",
        "railway:signal:electricity:ref={{idreseau}}",
    ],

    "REV": [
        "railway:signal:electricity=FR:REV",
        "railway:signal:electricity:ref={{idreseau}}",
    ],

    // Cab signalling / train protection

    "CAB E": [
        "railway:signal:train_protection=FR:CAB_E",
        "railway:signal:train_protection:function=entry",
        "railway:signal:train_protection:ref={{idreseau}}",
    ],

    "CAB S": [
        "railway:signal:train_protection=FR:CAB_S",
        "railway:signal:train_protection:function=exit",
        "railway:signal:train_protection:ref={{idreseau}}",
    ],

    // Wrong road / contre-sens

    "TECS": [
        "railway:signal:wrong_road=FR:TECS",
        "railway:signal:wrong_road:function=entry",
        "railway:signal:wrong_road:ref={{idreseau}}",
    ],

    "TSCS": [
        "railway:signal:wrong_road=FR:TSCS",
        "railway:signal:wrong_road:function=exit",
        "railway:signal:wrong_road:ref={{idreseau}}",
    ],

    // Whistle

    "SIFFLER": [
        "railway:signal:whistle=yes",
        "railway:signal:whistle:ref={{idreseau}}",
    ],

    // Departure

    "SLD": [
        "railway:signal:departure=FR:SLD",
        "railway:signal:departure:ref={{idreseau}}",
    ],
};

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

    // C->forward, D->backward, B->both
    sens: (raw) => {
        return { C: "forward", D: "backward", B: "both" }[raw] || raw;
    },

    // A->bridge, D->right, G->left
    position: (raw) => {
        return { A: "bridge", D: "right", G: "left" }[raw] || raw;
    },
};

// Tags shared across all signals in a co-located group.
// These are emitted once per node regardless of the number of signals.
export const COMMON_TAGS = [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "source=SNCF - 03/2022",
];

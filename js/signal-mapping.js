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
 * Reference: https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

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
        "railway:signal:speed_limit=FR:TIV_PENEXE",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=entry",
        "railway:signal:speed_limit:speed=60",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    "TIV PENREP": [
        "railway:signal:speed_limit=FR:TIV_PENREP",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=exit",
        "railway:signal:speed_limit:speed=none",
        "railway:signal:speed_limit:ref={{idreseau}}",
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

    "CHEVRON": [
        "railway:signal:route=FR:CHEVRON_BAS",
        "railway:signal:route:form=sign",
        "railway:signal:route:ref={{idreseau}}",
    ],

    // Route signals

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
};

// Field value converters applied when resolving {{field}} placeholders

export const FIELD_CONVERTERS = {

    // "077+305" -> "77.305"
    pk: (raw) => {
        if (!raw) return raw;
        const m = raw.match(/^(\d+)\+(\d+)$/);
        if (!m) return raw;
        const km = parseInt(m[1], 10);
        const dec = m[2].padEnd(3, '0').slice(0, 3);
        return `${km}.${dec}`;
    },

    // C->forward, D->backward, B->both
    sens: (raw) => {
        return { C: 'forward', D: 'backward', B: 'both' }[raw] || raw;
    },

    // A->bridge, D->right, G->left
    position: (raw) => {
        return { A: 'bridge', D: 'right', G: 'left' }[raw] || raw;
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

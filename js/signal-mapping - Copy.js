/**
 * signal-mapping.js
 * SNCF → OpenRailwayMap tag mapping.
 *
 * Format:
 *   Each type_if key maps to an array of "key=value" strings.
 *   Values may contain {{field}} placeholders resolved at runtime:
 *     {{pk}}       → railway:position:exact  (077+305 → 77.305)
 *     {{sens}}     → railway:signal:direction (C→forward, D→backward, B→both)
 *     {{position}} → railway:signal:position  (A→bridge, D→right, G→left)
 *     {{idreseau}} → raw SNCF internal ID
 *
 * Tags marked with value "*" are known unknowns — the value cannot be
 * determined from SNCF data and must be filled manually in JOSM.
 *
 * Reference: https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

export const SIGNAL_MAPPING = {

    // Main Signals

    "CARRE": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:main=FR:CARRE",
        "railway:signal:main:form=light",
        "railway:signal:main:states=FR:C;FR:VL",
        "railway:signal:main:ref={{idreseau}}",
    ],

    "CV": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:main=FR:CV",
        "railway:signal:main:form=light",
        "railway:signal:main:states=FR:CV;FR:M",
        "railway:signal:main:ref={{idreseau}}",
    ],

    "S": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:main=FR:S",
        "railway:signal:main:form=light",
        "railway:signal:main:states=FR:S;FR:VL",
        "railway:signal:main:ref={{idreseau}}",
    ],

    "GA": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:main=FR:GA",
        "railway:signal:main:form=light",
        "railway:signal:main:ref={{idreseau}}",
    ],

    // Distant Signals

    "A": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:distant=FR:A",
        "railway:signal:distant:form=light",
        "railway:signal:distant:states=FR:A;FR:VL",
        "railway:signal:distant:ref={{idreseau}}",
    ],

    "D": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:main=FR:D",
        "railway:signal:main:form=light",
        "railway:signal:main:states=FR:D;FR:A;FR:VL",
        "railway:signal:main:ref={{idreseau}}",
    ],

    // Fixed distant TIV board (Ordinary type)

    "TIV D FIXE": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:speed_limit_distant=FR:TIV-D_FIXE",
        "railway:signal:speed_limit_distant:form=sign",
        "railway:signal:speed_limit_distant:shape=square",
        "railway:signal:speed_limit_distant:speed=100",
        "railway:signal:speed_limit_distant:ref={{idreseau}}",
    ],

    // Mobile distant TIV board

    "TIV D MOB": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:speed_limit_distant=FR:TIV-D_MOB",
        "railway:signal:speed_limit_distant:form=light",
        "railway:signal:speed_limit_distant:speed=30",
        "railway:signal:speed_limit_distant:ref={{idreseau}}",
    ],

    // Mobile reminder TIV board

    "TIV R MOB": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:speed_limit_reminder=FR:TIV-R_MOB",
        "railway:signal:speed_limit_reminder:form=light",
        "railway:signal:speed_limit_reminder:speed=30",
        "railway:signal:speed_limit_reminder:ref={{idreseau}}",
    ],

    // Pentagonal distant TIV board

    "TIV PENDIS": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:speed_limit_distant=FR:TIV-PENDIS",
        "railway:signal:speed_limit_distant:form=sign",
        "railway:signal:speed_limit_distant:ref={{idreseau}}",
        "railway:signal:speed_limit_distant:speed=60",
    ],

    // Pentagonal execution TIV board

    "TIV PENEXE": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:speed_limit=FR:TIV_PENEXE",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=entry",
        "railway:signal:speed_limit:speed=60",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    // Pentagonal white board

    "TIV PENREP": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:speed_limit=FR:TIV_PENREP",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=exit",
        "railway:signal:speed_limit:speed=none",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    // Z board

    "Z": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:speed_limit=FR:Z",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=entry",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    // R board

    "R": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:speed_limit=FR:R",
        "railway:signal:speed_limit:form=sign",
        "railway:signal:speed_limit:function=exit",
        "railway:signal:speed_limit:ref={{idreseau}}",
    ],

    "CHEVRON": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:route=FR:CHEVRON_BAS",
        "railway:signal:route:form=sign",
        "railway:signal:route:ref={{idreseau}}",
    ],


    // Passenger stops

    "ARRET VOY": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:stop=FR:ARRET_TT",
        "railway:signal:stop:form=sign",
        "railway:signal:stop:ref={{idreseau}}",
    ],

    "HEURT...": [
        "railway=signal",
        "railway=buffer_stop",
        "railway:position:exact={{pk}}",
        "railway:signal:shunting=FR:HEURTOIR",
        "railway:signal:shunting:type=buffer_stop",
        "railway:signal:shunting:ref={{idreseau}}",
    ],

    // Indicateur de Direction

    "ID": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:route=FR:ID",
        "railway:signal:route:form=light",
        "railway:signal:route:states=FR:ID1;FR:ID2",
        "railway:signal:route:ref={{idreseau}}",
    ],

    // Tableau Indicateur de Direction à Distance

    "IDD": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:position={{position}}",
        "railway:signal:route_distant=FR:TIDD",
        "railway:signal:route_distant:form=light",
        "railway:signal:route_distant:states=off;left;right",
        "railway:signal:route_distant:ref={{idreseau}}",
    ],

    // Level Crossings

    "PN": [
        "railway=signal",
        "railway:position:exact={{pk}}",
        "railway:signal:direction={{sens}}",
        "railway:signal:crossing_info=FR:PN",
        "railway:signal:crossing_info:form=sign",
        "railway:signal:crossing_info:ref={{idreseau}}",
    ],
};

// ── Field value converters ──────────────────────────────────────────────────
// Applied when resolving {{field}} placeholders.

export const FIELD_CONVERTERS = {

  // pk: "077+305" → "77.305"  |  "120+640" → "120.640"
  pk: (raw) => {
    if (!raw) return raw;
    const m = raw.match(/^(\d+)\+(\d+)$/);
    if (!m) return raw;
    const km  = parseInt(m[1], 10);
    const dec = m[2].padEnd(3, '0').slice(0, 3);
    return `${km}.${dec}`;
  },

  // sens: C→forward, D→backward, I→both
  sens: (raw) => {
    const map = { C: 'forward', D: 'backward', B: 'both' };
    return map[raw] || raw;
  },

  // position: A→bridge, D→right, G→left, (others passed through)
  position: (raw) => {
    const map = { A: 'bridge', D: 'right', G: 'left' };
    return map[raw] || raw;
  },
};

// ── Tag merging for co-located signals ─────────────────────────────────────
// Tags that are identical across all signals at the same location are
// deduplicated — only one copy appears in the merged output.
// These are the "common" keys that should not repeat.
export const SHARED_TAG_KEYS = new Set([
  'railway',
  'railway:position:exact',
  'railway:signal:direction',
  'railway:signal:position',
  'source',
]);

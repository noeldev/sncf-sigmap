/**
 * signal-mapping.js
 * SNCF → OpenRailwayMap tag mapping.
 *
 * Format:
 *   Each type_if key maps to an array of "key=value" strings.
 *   Values may contain {{field}} placeholders resolved at runtime:
 *     {{pk}}       → railway:position:exact  (077+305 → 77.305)
 *     {{sens}}     → railway:signal:direction (C→forward, D→backward, I→both)
 *     {{position}} → railway:signal:position  (A→bridge, D→right, G→left)
 *     {{idreseau}} → raw SNCF internal ID
 *     {{code_ligne}}, {{nom_voie}}, {{code_voie}}, {{pk_raw}} → verbatim
 *
 * Tags marked with value "*" are known unknowns — the value cannot be
 * determined from SNCF data and must be filled manually in JOSM.
 *
 * Reference: https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France
 */

export const SIGNAL_MAPPING = {

  // ── Signaux d'arrêt ──────────────────────────────────────────────────────

  "CARRE": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:main:form=light",
    "railway:signal:main:ref={{idreseau}}",
    "railway:signal:main:states=stop;clear;caution;*",
    "railway:signal:main=FR:CARRE",
  ],

  "CARRE VIOLET": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:main:form=light",
    "railway:signal:main:ref={{idreseau}}",
    "railway:signal:main:states=stop;*",
    "railway:signal:main=FR:CV",
  ],

  "S": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:main:form=light",
    "railway:signal:main:ref={{idreseau}}",
    "railway:signal:main:states=stop;clear",
    "railway:signal:main=FR:S",
  ],

  "DISQUE": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:main:form=light",
    "railway:signal:main:ref={{idreseau}}",
    "railway:signal:main:states=stop;clear",
    "railway:signal:main=FR:DISQUE",
  ],

  "GUIDON ARR": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:main:form=light",
    "railway:signal:main:ref={{idreseau}}",
    "railway:signal:main:states=stop;clear",
    "railway:signal:main=FR:GA",
  ],

  // ── Signaux d'annonce ────────────────────────────────────────────────────

  "A": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:distant:form=light",
    "railway:signal:distant:ref={{idreseau}}",
    "railway:signal:distant:states=*",
    "railway:signal:distant=FR:A",
  ],

  // ── Signaux de vitesse ───────────────────────────────────────────────────

  "TIV D FIXE": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:speed_limit_distant:form=sign",
    "railway:signal:speed_limit_distant:ref={{idreseau}}",
    "railway:signal:speed_limit_distant:shape=square",
    "railway:signal:speed_limit_distant:speed=*",
    "railway:signal:speed_limit_distant=FR:TIV-D_FIXE",
  ],

  "TIV D MOB": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:speed_limit_distant:form=light",
    "railway:signal:speed_limit_distant:ref={{idreseau}}",
    "railway:signal:speed_limit_distant:speed=*",
    "railway:signal:speed_limit_distant=FR:TIV-D_MOB",
  ],

  "TIV PENDIS": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:speed_limit_distant:form=light",
    "railway:signal:speed_limit_distant:ref={{idreseau}}",
    "railway:signal:speed_limit_distant:speed=*",
    "railway:signal:speed_limit_distant=FR:TIV-PENDIS",
  ],

  "TIV EXEC": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:speed_limit:form=sign",
    "railway:signal:speed_limit:ref={{idreseau}}",
    "railway:signal:speed_limit:speed=*",
    "railway:signal:speed_limit=FR:TIV-EXEC",
  ],

  // ── Signaux de manœuvre / voie de service ────────────────────────────────

  "ARRET VOY": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:train_protection:form=sign",
    "railway:signal:train_protection:ref={{idreseau}}",
    "railway:signal:train_protection=FR:ARRET_VOY",
  ],

  "ARRET TRAM": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:train_protection:form=sign",
    "railway:signal:train_protection:ref={{idreseau}}",
    "railway:signal:train_protection=FR:ARRET_TRAM",
  ],

  "HEURTOIR": [
    "railway=buffer_stop",
    "railway:position:exact={{pk}}",
  ],

  // ── Signaux d'itinéraire ─────────────────────────────────────────────────

  "IDD": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:route_distant:form=light",
    "railway:signal:route_distant:ref={{idreseau}}",
    "railway:signal:route_distant:states=off;left;right",
    "railway:signal:route_distant=FR:TIDD",
  ],

  "CHEVRON": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:route:form=sign",
    "railway:signal:route:ref={{idreseau}}",
    "railway:signal:route=FR:CHEVRON",
  ],

  // ── Passage à niveau ─────────────────────────────────────────────────────

  "PN": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:crossing:form=sign",
    "railway:signal:crossing:ref={{idreseau}}",
    "railway:signal:crossing=FR:PN",
  ],

  // ── Tableau Z ────────────────────────────────────────────────────────────

  "Z": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:position={{position}}",
    "railway:signal:electricity:form=sign",
    "railway:signal:electricity:ref={{idreseau}}",
    "railway:signal:electricity=FR:Z",
  ],

  // ── Indicateur de direction ──────────────────────────────────────────────

  "ID": [
    "railway=signal",
    "railway:position:exact={{pk}}",
    "railway:signal:direction={{sens}}",
    "railway:signal:route:form=sign",
    "railway:signal:route:ref={{idreseau}}",
    "railway:signal:route=FR:ID",
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
    const map = { C: 'forward', D: 'backward', I: 'both' };
    return map[raw] || raw;
  },

  // position: A→bridge, D→right, G→left, (others passed through)
  position: (raw) => {
    const map = { A: 'bridge', D: 'right', G: 'left', N: 'normal', H: 'overhead' };
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

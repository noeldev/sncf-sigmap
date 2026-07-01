// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * signal-types.js - Signal type definitions table.
 *
 * SIGNAL_MAPPING is MODULE-PRIVATE. External code uses the public API below exclusively.
 *
 * Entry fields (top level):
 *   group      - application display group key
 *   cat        - OSM tag category suffix  (railway:signal:<cat>=...)
 *   type       - OSM tag value            (the FR:* string)
 *
 * Context sections (one or both):
 *   default    - luminous form: { linkedTo?, properties }
 *   mechanical - mechanical form: { linkedTo?, properties }
 *
 *   Signals with only mechanical: are always-mechanical (R30, RR30).
 *   Signals with both sections use mechanical when isMechanicalCombo() returns true.
 *   is detected in the co-location set, default otherwise.
 *   Signals with neither section keep linkedTo/properties at top level (legacy,
 *   backward-compatible for the ~700 luminous-only entries).
 *                GAIA keys are the primary keys of SIGNAL_MAPPING and equal to
 *                p.signalType in normalised signals.
 *
 * Public API:
 *   getMappingEntry(type)          - luminous definition, or null
 *   isMapped(type)                 - true when luminous OR always-mechanical
 *   getMappingEntries()            - all [type, def] pairs from SIGNAL_MAPPING
 *   getMappingKeys()               - all GAIA keys from SIGNAL_MAPPING
 *   getAllOsmPairs()                - all {cat,type,group,signalKey} from both tables
 *   resolveGroupDefs(feats)        - Map<signalType, effective def> for tag building
 */

// ===== Module-Private Data =====

const SIGNAL_MAPPING = {

    // Main signals
    "CARRE": {
        group: "main",
        cat: "main",
        type: "FR:C",
        default: {
            properties: {
                form: "light",
                shape: "FR:C",
                states: "FR:C;FR:A;FR:VL"
            }
        },
        mechanical: {
            properties: {
                form: "sign"
            }
        }
    },
    "CV": {
        group: "shunting",
        cat: "main",
        type: "FR:CV",
        default: {
            properties: {
                form: "light",
                shape: "FR:C",
                states: "FR:CV;FR:M"
            }
        },
        mechanical: {
            properties: {
                form: "sign"
            }
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
            states: "FR:S;FR:A;FR:VL"
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

    // Distant signals
    "D": {
        group: "distant",
        cat: "distant",
        type: "FR:D",
        default: {
            properties: {
                form: "light",
                states: "FR:D;FR:A;FR:VL"
            }
        },
        mechanical: {
            properties: { form: "sign" }
        }
    },
    "A": {
        group: "distant",
        cat: "distant",
        type: "FR:A",
        default: {
            properties: {
                form: "light",
                states: "FR:A;FR:VL"
            }
        },
        mechanical: {
            linkedTo: "CARRE",
            properties: {
                form: "sign"
            }
        }
    },
    "CARRE A": {
        group: "distant",
        cat: "distant",
        type: "FR:CARRE_A",
        properties: {
            form: "sign"
        }
    },

    // Speed limits
    "TIV D MOB": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:speed_indicator",
        subcat: "switchable",
        subtype: "FR:TIV-D",
        properties: {
            form: "light"
        }
    },
    "TIV R MOB": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:speed_indicator",
        subcat: "switchable",
        subtype: "FR:TIV-R",
        properties: {
            form: "light"
        }
    },
    "TIV D FIXE": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:speed_indicator",
        subcat: "fixed",
        subtype: "FR:TIV-D",
        linkedTo: "CARRE",
        properties: {
            form: "sign"
        }
    },
    "TIVD B FIX": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:speed_indicator",
        subcat: "fast",
        subtype: "FR:TIV-D",
        linkedTo: ["TIV D FIXE", "TIVD C FIX"],
        properties: {
            form: "sign"
        }
    },
    "TIVD C FIX": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:speed_indicator",
        subcat: "railcar",
        subtype: "FR:TIV-D",
        linkedTo: ["TIV D FIXE", "TIVD B FIX"],
        properties: {
            form: "sign"
        }
    },
    "P": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:P",
        properties: {
            form: "sign"
        }
    },

    // FR:Z marks the start of the speed-limited zone announced by the fixed TIV-D.
    // linkedTo groups Z with the TIV D FIXE rather than an unrelated speed_limit
    // signal (e.g. TIV_PENEXE). When two Z signals compete, the one with the
    // networkId closest to the TIV-D wins (networkId proximity selection).
    // FR:R marks the end of the zone; it is not co-located with the TIV-D.
    "Z": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:marker",
        subcat: "entry",
        subtype: "FR:Z",
        linkedTo: "TIV D FIXE",
        properties: {
            form: "sign",
        }
    },
    "R": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:marker",
        subcat: "exit",
        subtype: "FR:R",
        properties: {
            form: "sign"
        }
    },
    // The Km sign marks the transition point of a speed limit zone.
    // Always co-located with a fixed TIV-D (ordinary, B-type, or C-type).
    "REPER VIT": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:marker",
        subcat: "transition",
        subtype: "FR:Km",
        linkedTo: ["TIV D FIXE", "TIVD B FIX", "TIVD C FIX", "Z", "R"],
        properties: {
            form: "sign"
        }
    },

    "CHEVRON": {
        group: "miscellaneous",
        cat: "minor",
        type: "FR:chevron",
        properties: {
            form: "sign"
        }
    },

    "TIV PENDIS": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:speed_indicator",
        subcat: "freight",
        subtype: "FR:TIV-D",
        properties: {
            form: "sign"
        }
    },
    // The L plate is always mounted below a pentagonal TIV_PENDIS to indicate
    // the speed restriction applies only to certain locomotive series.
    "L": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:speed_indicator",
        subcat: "freight:condition",
        subtype: "FR:L",
        linkedTo: "TIV PENDIS",
        properties: {
            form: "sign",
            for: "locomotive"
        }
    },
    "TIV PENEXE": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:speed_indicator",
        subcat: "freight",
        subtype: "FR:TIV-E",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "TIV PENREP": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:speed_indicator",
        subcat: "freight",
        subtype: "FR:white_board",
        properties: {
            form: "sign",
            function: "exit"
        }
    },

    // Route indicators
    "ID": {
        group: "route",
        cat: "route",
        type: "FR:ID",
        linkedTo: ["CARRE", "CV"],
        properties: {
            form: "light"
        }
    },
    "IDD": {
        group: "route",
        cat: "switch",
        type: "FR:TIDD",
        properties: {
            form: "light"
        }
    },
    "TLD": {
        group: "route",
        cat: "route_distant",
        type: "FR:TLD",
        allowMultiple: true,
        properties: {
            form: "light",
            shape: "double"
        }
    },
    "DESTI": {
        group: "route",
        cat: "route_info",
        type: "FR:track_name",
        allowMultiple: true,
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
    "FEUXVERTS": {
        group: "crossing",
        cat: "crossing",
        type: "FR:SFC",
        linkedTo: "PN",
        properties: {
            form: "light"
        }
    },

    // Traction electricity
    "SECT": {
        group: "electricity",
        cat: "electricity",
        type: "FR:power_off_advance",
        properties: {
            type: "power_off_advance",
            form: "sign"
        }
    },
    "CC EXE": {
        group: "electricity",
        cat: "electricity",
        type: "FR:power_off",
        properties: {
            type: "power_off",
            form: "sign"
        }
    },
    "CC FIN": {
        group: "electricity",
        cat: "electricity",
        type: "FR:power_on",
        properties: {
            type: "power_on",
            form: "sign"
        }
    },
    "REV": {
        group: "electricity",
        cat: "electricity",
        type: "FR:REV",
        properties: {
            type: "power_on",
            form: "sign",
        }
    },
    "BP DIS": {
        group: "electricity",
        cat: "electricity",
        type: "FR:pantograph_down_advance",
        properties: {
            type: "pantograph_down_advance",
            form: "sign"
        }
    },
    "BP EXE": {
        group: "electricity",
        cat: "electricity",
        type: "FR:pantograph_down",
        properties: {
            type: "pantograph_down",
            form: "sign"
        }
    },
    "BP FIN": {
        group: "electricity",
        cat: "electricity",
        type: "FR:pantograph_up",
        properties: {
            type: "pantograph_up",
            form: "sign"
        }
    },
    "FIN CAT": {
        group: "electricity",
        cat: "electricity",
        type: "FR:end_of_catenary",
        properties: {
            type: "end_of_catenary",
            form: "sign"
        }
    },
    "GIVRE": {
        group: "electricity",
        cat: "electricity",
        type: "FR:frost",
        properties: {
            form: "light"
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

    // Cab signalling
    "CAB E": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:cab_signalling_advance",
        properties: {
            form: "sign"
        }
    },
    "CAB R": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:cab_signalling_entry",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "CAB S": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:cab_signalling_exit",
        properties: {
            form: "sign",
            function: "exit"
        }
    },
    "REP TVM": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:marker",
        subcat: "main",
        subtype: "stop_marker",
        properties: {
            form: "sign"
        }
    },
    "REP TGV": {
        group: "trainProtection",
        cat: "train_protection",
        type: "ETCS:marker",
        subcat: "main",
        subtype: "ETCS:stop_marker",
        properties: {
            form: "sign"
        }
    },

    // Wrong-road (IPCS)
    "TECS": {
        group: "wrongRoad",
        cat: "wrong_road",
        type: "FR:transition",
        subcat: "entry",
        subtype: "FR:TECS",
        properties: {
            form: "light"
        }
    },
    "TSCS": {
        group: "wrongRoad",
        cat: "wrong_road",
        type: "FR:transition",
        subcat: "exit",
        subtype: "FR:TSCS",
        properties: {
            form: "light"
        }
    },

    // Distant stop signs
    "ARRET A": {
        group: "stop",
        cat: "stop_distant",
        type: "FR:ARRET_A",
        properties: {
            form: "sign"
        }
    },
    "STOP A": {
        group: "stop",
        cat: "stop_distant",
        type: "FR:STOP_A",
        properties: {
            form: "sign"
        }
    },

    // Stop signs
    "ARRET": {
        group: "stop",
        cat: "stop",
        type: "FR:ARRET",
        properties: {
            form: "sign"
        }
    },
    "ARRET VOY": {
        group: "stop",
        cat: "stop",
        type: "FR:passenger_stop",
        subcat: "classic",
        subtype: "FR:TT",
        allowMultiple: true,
        properties: {
            form: "sign",
            for: "head_of_train"
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
    "JAL ARRET": {
        group: "stop",
        cat: "stop",
        type: "FR:marker",
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

    // Stations and facilities
    "GARE": {
        group: "station",
        cat: "station_distant",
        type: "FR:GARE",
        properties: {
            form: "sign"
        }
    },
    "APPROCHETS": {
        group: "station",
        cat: "station_distant",
        type: "FR:facility_approach_simplified",
        properties: {
            form: "sign"
        }
    },
    "APPROETSA": {
        group: "station",
        cat: "station_distant",
        type: "FR:facility_approach",
        properties: {
            form: "sign"
        }
    },
    "LIMITETS": {
        group: "station",
        cat: "station",
        type: "FR:facility_boundary",
        properties: {
            form: "sign"
        }
    },

    // Departure
    "SLD": {
        group: "station",
        cat: "departure",
        type: "FR:SLD",
        linkedTo: ["CARRE", "CV"],
        properties: {
            type: "await",
            form: "light"
        }
    },
    "MIBLAN VER": {
        group: "station",
        cat: "departure",
        type: "FR:departure_marker",
        linkedTo: ["CARRE", "CV"],
        properties: {
            type: "allow",
            form: "plate"
        }
    },
    "DD": {
        group: "station",
        cat: "departure",
        type: "FR:DD",
        linkedTo: ["CARRE", "CV"],
        properties: {
            type: "request",
            form: "plate"
        }
    },
    "REP ITIN": {
        group: "station",
        cat: "departure",
        type: "FR:RLI",
        allowMultiple: true,
        properties: {
            form: "light"
        }
    },

    // Converging tracks
    "VOIE CONV": {
        group: "station",
        cat: "minor",
        type: "FR:TLC",
        properties: {
            form: "light"
        }
    },
    "IDP": {
        group: "station",
        cat: "minor",
        type: "FR:TIP",
        properties: {
            form: "light"
        }
    },

    // Shunting
    "JAL MAN": {
        group: "shunting",
        cat: "shunting",
        type: "FR:marker",
        properties: {
            form: "sign"
        }
    },
    "DEPOT": {
        group: "shunting",
        cat: "shunting_route",
        type: "FR:destination",
        subcat: "depot",
        subtype: "FR:D",
        properties: {
            form: "sign"
        }
    },
    "G": {
        group: "shunting",
        cat: "shunting_route",
        type: "FR:destination",
        subcat: "stabling",
        subtype: "FR:G",
        properties: {
            form: "sign"
        }
    },
    "IMP": {
        group: "shunting",
        cat: "shunting_route",
        type: "FR:destination",
        subcat: "dead_end",
        subtype: "FR:Imp",
        properties: {
            form: "sign"
        }
    },
    "HEURT...": {
        group: "shunting",
        cat: "shunting_route",
        type: "FR:destination",
        subcat: "buffer_stop",
        subtype: "FR:Heurtoir",
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
    // SLM (Signal Lumineux de Manoeuvre): installed on main tracks to facilitate
    // shunting operations. Despite being on main infrastructure it is a shunting
    // signal, so cat=shunting to avoid conflicts with Carre (cat=main).
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
        cat: "minor",
        type: "FR:reduced_clearance",
        properties: {
            form: "sign"
        }
    },
    "TUNNEL": {
        group: "miscellaneous",
        cat: "minor",
        type: "FR:tunnel",
        properties: {
            form: "sign"
        }
    },
    "SIFFLER": {
        group: "miscellaneous",
        cat: "whistle",
        type: "FR:S",
        properties: {
            form: "sign"
        }
    },

    // Always-mechanical signs — these are only ever installed as physical panels,
    // never as luminous signals. mechanical: true means resolveGroupDefs() uses
    // properties directly without checking for mechanical combos.
    "R30": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:R30",
        mechanical: {
            properties: {
                form: "sign"
            }
        }
    },
    "RR30": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:RR30",
        mechanical: {
            properties: {
                form: "sign"
            }
        }
    },

    // Border signals
    "CARRE (CH)": {
        group: "main",
        cat: "main",
        type: "CH-FDV:l",
        properties: {
            form: "light",
            function: "entry",
            states: "CH-FDV:524;CH-FDV:530;CH-FDV:542;CH-FDV:545"
        }
    },
    "S (CH)": {
        group: "main",
        cat: "main",
        type: "CH-FDV:l",
        properties: {
            form: "light",
            function: "block",
            states: "CH-FDV:524;CH-FDV:530;CH-FDV:542"
        }
    },
    "A (CH)": {
        group: "distant",
        cat: "distant",
        type: "CH-FDV:l",
        properties: {
            form: "light",
            states: "CH-FDV:519;CH-FDV:528;CH-FDV:529;CH-FDV:534;CH-FDV:536"
        }
    },
    // Räumungssignal (evacuation signal): co-located with S (CH) or CARRE (CH).
    // The SNCF dataset uses the GAIA type "CV" for this signal, which is
    // disambiguated from the French Carre Violet (FR:CV) by Swiss context
    // detection in conflict-detector.js via getSwissContextRemap().
    "CV (CH)": {
        group: "shunting",
        cat: "shunting",
        type: "CH-FDV:308",
        properties: {
            form: "light",
            states: "CH-FDV:308;CH-FDV:310"
        }
    },
};

// ===== Private helpers =====

/**
 * Resolve the active section for a mapping entry.
 * Returns the right properties/linkedTo without mutating the entry.
 *
 * @param {object}  entry   Raw SIGNAL_MAPPING entry.
 * @param {boolean} isMech  True when the location is a mechanical combo.
 * @returns {object}        Entry with the active section spread to top level.
 */
function _resolveSection(entry, isMech) {
    // Signals with only a mechanical section are always-mechanical (R30, RR30).
    // Signals with both sections pick based on isMech.
    // Signals with neither section (luminous-only, ~75 entries) return as-is.
    const section = isMech ? entry.mechanical : entry.default;
    return section ? { ...entry, ...section } : entry;
}

// ===== Border Context Remap =====

// Registry of contextual type remappings based on co-located signals.
// Allows disambiguation when a GAIA type has different meanings depending
// on the regional context (e.g., cross-border installations).
// To add a new country context, simply add a new object to this array.
const BORDER_CONTEXTS = [
    {
        // Swiss border context
        triggers: new Set(['S (CH)', 'CARRE (CH)']),
        remaps: new Map([
            ['CV', 'CV (CH)'], // SNCF "CV" becomes Swiss evacuation signal [Räumungssignal] (CH-FDV:308)
        ]),
    },
    // Future contexts (Germany, Belgium, etc.) can be added here.
];

/**
 * Return a type remap table for a given location based on contextual triggers.
 * 
 * @param {Iterable<string>} locationTypes  All GAIA types at a location.
 * @returns {Map<string, string>}           originalType -> effectiveType
 */
function _getContextRemaps(locationTypes) {
    const typeSet = locationTypes instanceof Set ? locationTypes : new Set(locationTypes);
    const remap = new Map();

    for (const ctx of BORDER_CONTEXTS) {
        // Check if any trigger type is present at this location
        const triggered = [...ctx.triggers].some(t => typeSet.has(t));
        if (triggered) {
            // Merge applicable remaps
            for (const [from, to] of ctx.remaps) {
                if (typeSet.has(from)) {
                    remap.set(from, to);
                }
            }
        }
    }

    return remap;
}

// ===== Public API =====

/**
 * Apply context-specific type remaps (e.g., cross-border) to a list of signal features.
 * Mutates `feat.p.signalType` in place so all downstream processing (conflict detection, 
 * tag building, map rendering, popups) sees the effective type.
 *
 * @param {Array<{p: {signalType: string}}>} feats  Signals at the same location.
 */
export function applyContextRemaps(feats) {
    if (!feats || feats.length === 0) return;

    const typeSet = new Set(feats.map(f => f.p.signalType));
    const remap = _getContextRemaps(typeSet);
    if (remap.size === 0) return;

    for (const feat of feats) {
        const remapped = remap.get(feat.p.signalType);
        if (remapped !== undefined) {
            feat.p.signalType = remapped;
        }
    }
}

/**
 * Return true when the co-located signal types form a mechanical installation.
 *
 * Two detection rules, derived directly from the signal table:
 *
 * Rule 1 — Always-mechanical presence:
 *   A signal with only a mechanical section (no default) is never luminous
 *   (e.g. R30, RR30). Its presence implies a mechanical installation for all
 *   co-located signals that have a mechanical section.
 *   Adding a new always-mechanical type only requires giving it a mechanical
 *   section without a default section in SIGNAL_MAPPING — no table update needed.
 *
 * Rule 2 — Impossible luminous combination:
 *   A + D (Avertissement + Disque) cannot be co-located on luminous infrastructure.
 *   Their co-location unambiguously implies mechanical signals.
 *
 * MECHANICAL_COMBOS is not needed — the rules are derived from the data.
 *
 * @param {Set<string>} typeSet  All signal types at a physical location.
 * @returns {boolean}
 */
export function isMechanicalCombo(typeSet) {
    // Rule 1: any always-mechanical type triggers mechanical context.
    const hasMechOnly = [...typeSet].some(t => {
        const e = SIGNAL_MAPPING[t];
        return e?.mechanical && !e.default;
    });
    if (hasMechOnly) return true;

    // Rule 2: A+D is impossible in luminous signaling.
    return typeSet.has('A') && typeSet.has('D');
}

/**
 * Return the mapping entry for a signal type, or null when unmapped.
 * @param {string} signalType  GAIA key, e.g. 'CARRE', 'RR30'
 * @returns {object|null}
 */
export function getMappingEntry(signalType) {
    return SIGNAL_MAPPING[signalType] ?? null;
}

/**
 * Return true when the signal type has any mapping entry.
 * @param {string} signalType
 * @returns {boolean}
 */
export function isMapped(signalType) {
    return signalType in SIGNAL_MAPPING;
}

/**
 * Return all GAIA keys from SIGNAL_MAPPING.
 * @returns {string[]}
 */
export function getMappingKeys() {
    return Object.keys(SIGNAL_MAPPING);
}

/**
 * Return all [signalType, definition] pairs from SIGNAL_MAPPING.
 * @returns {[string, object][]}
 */
export function getMappingEntries() {
    return Object.entries(SIGNAL_MAPPING);
}

/**
 * Return all unique OSM (cat, type) pairs from SIGNAL_MAPPING.
 * Combo-mechanical types share cat/type with their luminous variant, so only
 * one entry per unique pair is included.
 * @returns {Array<{cat: string, type: string, group: string, signalKey: string}>}
 */
export function getAllOsmPairs() {
    const seen = new Set();
    const pairs = [];
    for (const [signalKey, def] of Object.entries(SIGNAL_MAPPING)) {
        const key = `${def.cat}|${def.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ cat: def.cat, type: def.type, group: def.group, signalKey });
    }
    return pairs;
}

/**
 * Resolve the effective tag definition for every signal type in a node.
 *
 * @param {Array<{p:{signalType:string}}>} nodeFeats  Signals in this OSM node.
 * @param {boolean} isMech  Pre-computed mechanical flag for this location.
 *   Computed once by isMechanicalCombo() in the grouping layer and passed here
 *   to avoid re-computing the mechanical combo check on every node.
 * @returns {Map<string, object|null>}
 */
export function resolveGroupDefs(nodeFeats, isMech) {
    const result = new Map();
    for (const { p: { signalType } } of nodeFeats) {
        if (result.has(signalType)) continue;
        const entry = SIGNAL_MAPPING[signalType] ?? null;
        result.set(signalType, entry ? _resolveSection(entry, isMech) : null);
    }
    return result;
}

/**
 * Return the display group key for a signal type.
 * group is always at the top level — invariant across luminous/mechanical forms.
 * @param {string} signalType
 * @returns {string|null}
 */
export function getGroupForType(signalType) {
    return SIGNAL_MAPPING[signalType]?.group ?? null;
}

/**
 * Return the display group key for an OSM cat string.
 * SIGNAL_MAPPING is the single table — all OSM cats are covered here.
 * @param {string} osmCat  e.g. 'main', 'speed_limit_distant'
 * @returns {string|null}
 */
export function getGroupForCat(osmCat) {
    for (const def of Object.values(SIGNAL_MAPPING)) {
        if (def.cat === osmCat) return def.group;
        // Slot key match for entries with subcat (e.g. "wrong_road:entry", "stop:classic").
        if (def.subcat && `${def.cat}:${def.subcat}` === osmCat) return def.group;
    }
    return null;
}

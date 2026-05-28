/**
 * signal-types.js - Signal type definitions table.
 *
 * The SIGNAL_MAPPING constant is the single source of truth for all
 * signal type metadata: display category, OpenRailwayMap tag category/type,
 * static tag properties, and optional inter-signal affinity.
 *
 * Entry fields:
 *   group      - application display category key (cat-mapping.js)
 *   cat        - OSM tag category suffix  (railway:signal:<cat>=...)
 *   type       - OSM tag value            (the FR:* string)
 *   properties - additional static OSM tags written under railway:signal:<cat>:*
 *   linkedTo   - (optional) preferred co-node affinity. Accepts a GAIA key
 *                string (e.g. "TIV D FIXE") or an array of such strings.
 *                GAIA keys are the primary keys of SIGNAL_MAPPING and equal to
 *                p.signalType in normalised signals. Using key strings avoids
 *                duplicating OSM tag values and is resilient to tag changes.
 *                When multiple groups qualify (e.g. two Z pancartes both want
 *                the same TIV-D), the group whose anchor networkId is
 *                numerically closest to the signal's networkId wins.
 *                Examples:
 *                  FR:Z  (speed limit start) -> linkedTo "TIV D FIXE"
 *                  FR:L  (locomotive plate)  -> linkedTo "TIV PENDIS"
 *                  FR:DD (departure plate)   -> linkedTo "CARRE"
 *
 * Consumed exclusively by signal-mapping.js / signal-grouping.js.
 */

export const SIGNAL_MAPPING = {

    // Main signals
    "CARRE": {
        group: "main",
        cat: "main",
        type: "FR:C",
        properties: {
            form: "light",
            shape: "FR:C",
            states: "FR:C;FR:VL"
        }
    },
    "CV": {
        group: "shunting",
        cat: "main",
        type: "FR:CV",
        properties: {
            form: "light",
            shape: "FR:C",
            states: "FR:CV;FR:M"
        }
    },
    "R30": {
        group: "main",
        cat: "main",
        type: "FR:R30",
        properties: {
            form: "sign"
        }
    },
    "RR30": {
        group: "main",
        cat: "main",
        type: "FR:RR30",
        properties: {
            form: "sign"
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

    // Distant signals
    "D": {
        group: "distant",
        cat: "distant",
        type: "FR:D",
        properties: {
            form: "light",
            states: "FR:D;FR:A;FR:VL"
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
        type: "FR:TIV-D", // TODO FR:TIV-D_MOB
        properties: {
            type: "switchable",
            form: "light",
            condition: "diverting",
            speed: "0"
        }
    },
    "TIV R MOB": {
        group: "speedLimit",
        cat: "speed_limit_reminder",
        type: "FR:TIV-R",
        properties: {
            form: "light",
            speed: "0"
        }
    },
    "TIV D FIXE": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D",
        linkedTo: "CARRE",
        properties: {
            form: "sign",
            speed: "0"
        }
    },
    "TIVD B FIX": {
        group: "speedLimit",
        cat: "speed_limit_distant:fast",
        type: "FR:TIV-D_B",
        linkedTo: ["TIV D FIXE", "TIVD C FIX"],
        properties: {
            form: "sign",
            speed: "120"
        }
    },
    "TIVD C FIX": {
        group: "speedLimit",
        cat: "speed_limit_distant:self",
        type: "FR:TIV-D_C",
        linkedTo: ["TIV D FIXE", "TIVD B FIX"],
        properties: {
            form: "sign",
            speed: "120"
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
        type: "FR:Z",
        linkedTo: "TIV D FIXE",
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
        group: "miscellaneous",
        cat: "minor",
        type: "FR:chevron",
        properties: {
            type: "down",
            form: "sign"
        }
    },
    "TIV PENDIS": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:TIV_PENDIS",
        properties: {
            form: "sign",
            shape: "pentagon",
            speed: "30"
        }
    },
    // The L plate is always mounted below a pentagonal TIV_PENDIS to indicate
    // the speed restriction applies only to certain locomotive series.
    "L": {
        group: "speedLimit",
        cat: "speed_limit_distant:condition",
        type: "FR:L",
        linkedTo: "TIV PENDIS",
        properties: {
            form: "sign"
        }
    },
    "TIV PENEXE": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:TIV_PENEXE",
        properties: {
            form: "sign",
            shape: "pentagon",
            function: "entry",
            speed: "30"
        }
    },
    "TIV PENREP": {
        group: "speedLimit",
        cat: "speed_limit",
        type: "FR:TIV_PENREP",
        properties: {
            form: "sign",
            shape: "pentagon",
            function: "exit"
        }
    },
    // The Km sign marks the transition point of a speed limit zone.
    // Always co-located with a fixed TIV-D (ordinary, B-type, or C-type).
    "REPER VIT": {
        group: "speedLimit",
        cat: "speed_limit:marker",
        type: "FR:Km",
        properties: {
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
        properties: {
            form: "light",
            shape: "dual"
        }
    },
    "DESTI": {
        group: "route",
        cat: "route_info",
        type: "FR:track_name",
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
        properties: {
            form: "light",
            arrangement: "vertical",
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

    // Cab signalling (TVM / ETCS)
    "CAB E": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:CAB_DIS",
        properties: {
            form: "sign"
        }
    },
    "CAB R": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:CAB_EXE",
        properties: {
            form: "sign",
            function: "entry"
        }
    },
    "CAB S": {
        group: "trainProtection",
        cat: "train_protection",
        type: "FR:CAB_FIN",
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
        cat: "wrong_road:entry",
        type: "FR:TECS",
        properties: {
            form: "light",
            function: "entry"
        }
    },
    "TSCS": {
        group: "wrongRoad",
        cat: "wrong_road:exit",
        type: "FR:TSCS",
        properties: {
            form: "light",
            function: "exit"
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
        type: "FR:TT",
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
    "JAL ARRET": {
        group: "stop",
        cat: "stop",
        type: "FR:Jalon",
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
        type: "FR:Limites",
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
        type: "FR:MIB-MIV",
        linkedTo: "CARRE",
        properties: {
            type: "allow",
            form: "plate"
        }
    },
    "DD": {
        group: "station",
        cat: "departure",
        type: "FR:DD",
        linkedTo: "CARRE",
        properties: {
            type: "request",
            form: "plate"
        }
    },
    "REP ITIN": {
        group: "station",
        cat: "station",
        type: "FR:RLI",
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
        type: "FR:shunting_marker",
        properties: {
            form: "sign",
            type: "shunting_marker"
        }
    },
    "DEPOT": {
        group: "shunting",
        cat: "shunting_route:depot",
        type: "FR:D",
        properties: {
            form: "sign"
        }
    },
    "G": {
        group: "shunting",
        cat: "shunting_route:stabling",
        type: "FR:G",
        properties: {
            form: "sign"
        }
    },
    "IMP": {
        group: "shunting",
        cat: "shunting_route:dead_end",
        type: "FR:Imp",
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
        type: "FR:buffer_stop",
        properties: {
            type: "buffer_stop",
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
        type: "FR:Gabarit",
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
};

/**
 * signal-types.js — Signal type definitions table.
 *
 * The SIGNAL_MAPPING constant is the single source of truth for all
 * signal type metadata: display category, OpenRailwayMap tag category/type,
 * and static tag properties.
 *
 * Consumed exclusively by signal-mapping.js.
 */

export const SIGNAL_MAPPING = {

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
    "CV": {
        group: "shunting",
        cat: "main",
        type: "FR:CV",
        properties: {
            form: "light",
            plate: "FR:NF",
            shape: "FR:C",
            states: "FR:CV;FR:M"
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
            form: "light",
            condition: "diverting",
            speed: "90"
        }
    },
    "TIV R MOB": {
        group: "speedLimit",
        cat: "speed_limit_reminder",
        type: "FR:TIV-R",
        properties: {
            form: "light",
            speed: "90"
        }
    },
    "TIV D FIXE": {
        group: "speedLimit",
        cat: "speed_limit_distant",
        type: "FR:TIV-D",
        properties: {
            form: "sign",
            shape: "square",
            speed: "90"
        }
    },
    "TIVD B FIX": {
        group: "speedLimit",
        cat: "speed_limit_distant:fast",
        type: "FR:TIV-D_B",
        properties: {
            form: "sign",
            speed: "120"
        }
    },
    "TIVD C FIX": {
        group: "speedLimit",
        cat: "speed_limit_distant:self",
        type: "FR:TIV-D_C",
        properties: {
            form: "sign",
            speed: "120"
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
        type: "FR:TIV_PENDIS",
        properties: {
            form: "sign",
            shape: "pentagon",
            speed: "30"
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
    "REPER VIT": {
        group: "speedLimit",
        cat: "speed_limit:marker",
        type: "FR:KM",
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

    // Distant Stop signs
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
        type: "FR:ARRET_TT",
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

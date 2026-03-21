/**
 * cantonment.js — Line label and cantonment mode lookup from index.json data.
 *
 * Call initCantonment(index) once after index.json has been fetched
 * (typically in app.js, right after the existing filter index init).
 *
 * Public API:
 *   initCantonment(index)                    — load lignes / cantons / canton_segs
 *   getLineLabel(code_ligne)                 — returns lib_ligne string, or null
 *   getCantonMode(code_ligne, pk, sens)      — returns abbreviated mode string, or null
 *
 * Direction semantics (sens):
 *   The cantonment dataset defines segments by [pkd, pkf] where both values
 *   increase with the line's kilometre origin (PK 0+000). Sens tells us which
 *   way the train (and the signal) is facing:
 *     C (croissant)  — train moves toward higher PKs; downstream (aval) is the
 *                      segment whose start pkd is at or before the signal PK.
 *     D (décroissant) — train moves toward lower PKs; downstream is the segment
 *                      whose end pkf is at or after the signal PK.
 *   At an exact boundary (signal PK = pkf of segment A = pkd of segment B),
 *   sens determines which segment is aval: C → B (starting here), D → A (ending
 *   here). See _pkInSegment for the precise boundary conditions.
 */

import { parsePkAsMeters } from './sncf-convert.js';


/* ===== Module state ===== */

/** code_ligne (string) → { count, label? } — merged line entry from index.json */
let _lignes = null;

/** Ordered list of abbreviated canton mode labels, indexed by canton_idx. */
let _cantons = null;

/**
 * Per-line segment lookup map built at init time.
 * code_ligne → Array<{ pkd: number, pkf: number, cid: number }>
 * pkd / pkf are integer metres (consistent with parsePkAsMeters output from sncf-convert.js).
 * Avoids a full O(n) scan of canton_segs on every popup open.
 */
let _segMap = null;


/* ===== Public API ===== */

/**
 * Initialise cantonment data from the parsed index.json object.
 * Must be called before getLineLabel / getCantonMode are used.
 * Safe to call multiple times (re-initialises on each call).
 *
 * Expected index shape (produced by TileBuilder):
 *   index.code_ligne  — { "205000": { count: 42, label: "Ligne de Soissons à Givet" }, … }
 *                        label is absent when the line has no cantonment entry
 *   index.cantons     — [ "BAL", "BAPR", … ]
 *   index.canton_segs — [ ["205000", 69350, 72241, 0], … ]
 *                        field order: code_ligne, pkd_m, pkf_m, canton_idx
 *
 * @param {object} index  Parsed index.json
 */
export function initCantonment(index) {
    _lignes = index.code_ligne ?? {};
    _cantons = index.cantons ?? [];

    // Build O(1) per-line segment lookup from the flat canton_segs list.
    _segMap = new Map();
    for (const seg of (index.canton_segs ?? [])) {
        const [cl, pkd, pkf, cid] = seg;
        const key = String(cl);
        let list = _segMap.get(key);
        if (!list) { list = []; _segMap.set(key, list); }
        list.push({ pkd, pkf, cid });
    }
}

/**
 * Returns the display name of the line, or null if not found.
 * @param {string} code_ligne
 * @returns {string|null}
 */
export function getLineLabel(code_ligne) {
    if (!_lignes) return null;
    return _lignes[String(code_ligne)]?.label ?? null;
}

/**
 * Returns the abbreviated cantonment mode that is downstream (aval) of the
 * signal, taking direction into account.
 *
 * Returns null when:
 *   - the module has not been initialised yet,
 *   - code_ligne is not in the cantonment dataset,
 *   - pk cannot be parsed as a valid SNCF PK string,
 *   - no segment covers the signal's PK in the given direction.
 *
 * When multiple segments overlap at a non-boundary PK (unusual), the first
 * match in insertion order is returned.
 *
 * @param {string} code_ligne
 * @param {string} pk    SNCF PK string, e.g. "069+350"
 * @param {string} sens  Direction code: "C" (croissant) or "D" (décroissant)
 * @returns {string|null}
 */
export function getCantonMode(code_ligne, pk, sens) {
    if (!_segMap) return null;

    const pk_m = parsePkAsMeters(pk);
    if (pk_m === null) return null;

    const segs = _segMap.get(String(code_ligne));
    if (!segs) return null;

    for (const { pkd, pkf, cid } of segs) {
        if (_pkInSegment(pk_m, pkd, pkf, sens)) return _cantons[cid] ?? null;
    }
    return null;
}


/* ===== Private helpers ===== */

/**
 * Returns true when pk_m falls within the [pkd, pkf] segment, with boundary
 * handling driven by the signal direction (sens).
 *
 * At an exact boundary where pk_m simultaneously equals pkf of one segment
 * and pkd of the next, the downstream segment depends on the direction of
 * travel:
 *
 *   C (croissant) — train moves toward higher PKs.  The segment that *starts*
 *     at pk_m is downstream: pkd ≤ pk_m < pkf.  At pk_m = pkd the condition
 *     is satisfied; at pk_m = pkf it is not, so the preceding segment is
 *     excluded.
 *
 *   D (décroissant) — train moves toward lower PKs.  The segment that *ends*
 *     at pk_m is downstream: pkd < pk_m ≤ pkf.  At pk_m = pkf the condition
 *     is satisfied; at pk_m = pkd it is not.
 *
 *   Unknown / absent — both boundaries are inclusive; first match wins.
 *
 * @param {number} pk_m  Signal PK in metres (integer)
 * @param {number} pkd   Segment start in metres (integer)
 * @param {number} pkf   Segment end in metres (integer)
 * @param {string} sens  "C", "D", or absent
 * @returns {boolean}
 */
function _pkInSegment(pk_m, pkd, pkf, sens) {
    if (sens === 'C') return pk_m >= pkd && pk_m < pkf;
    if (sens === 'D') return pk_m > pkd && pk_m <= pkf;
    return pk_m >= pkd && pk_m <= pkf;
}

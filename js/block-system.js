/**
 * block-system.js — Line label and block signaling mode lookup from index.json data.
 *
 * Call initBlockSystem(index) once after index.json has been fetched.
 *
 * Public API:
 *   initBlockSystem(index)                   — load line labels, block types, segments
 *   getLineLabel(lineCode)                   — returns line display name, or null
 *   getBlockType(lineCode, milepost, direction) — returns abbreviated block type string, or null
 *
 * Direction semantics:
 *   The block signaling dataset defines segments by [start, end] where both values
 *   increase with the line's kilometer origin. Direction is the OSM value from
 *   normalizeSignal() — 'forward' or 'backward':
 *     'forward'  — train moves toward higher PKs; downstream is the block starting
 *                  at or after the signal milepost.
 *     'backward' — train moves toward lower PKs; downstream is the block ending
 *                  at or before the signal milepost.
 *   At an exact boundary, direction determines which block is downstream.
 *   See _isSignalInSegment for the precise boundary conditions.
 */

import { parseMilepostAsMeters } from './sncf-convert.js';


// ===== Module state =====

/** lineCode (string) → { count, label? } — merged line entry from index.json. */
let _lines = null;

/** Ordered list of abbreviated block type labels (e.g. "BAL", "BAPR"), indexed by block_idx. */
let _blockTypes = null;

/**
 * Per-line segment lookup map built at init time.
 * lineCode → Array<{ start: number, end: number, blockIdx: number }>
 * start / end are integer meters (from parseMilepostAsMeters in sncf-convert.js).
 * Avoids a full O(n) scan of canton_segs on every popup open.
 */
let _blockMap = null;


// ===== Public API =====

/**
 * Initialize block system data from the parsed index.json object.
 * Must be called before getLineLabel / getBlockType are used.
 * Safe to call multiple times (re-initializes on each call).
 *
 * Expected index shape (produced by TileBuilder):
 *   index.lineCode       — { "205000": { count: 42, label: "Ligne de Soissons à Givet" }, … }
 *                          label is absent when the line has no block signaling entry
 *   index.blockType      — [ "BAL", "BAPR", … ]
 *   index.blockSegments  — [ ["205000", 69350, 72241, 0], … ]
 *                          field order: line_code, start_m, end_m, block_type_idx
 *
 * @param {object} index  Parsed index.json
 */
export function initBlockSystem(index) {
    _lines = index.lineCode ?? {};
    _blockTypes = index.blockType ?? [];

    // Build O(1) per-line block segment lookup from the flat blockSegments list.
    _blockMap = new Map();
    for (const segment of (index.blockSegments ?? [])) {
        const [lineCode, start, end, blockIdx] = segment;
        const key = String(lineCode);
        let list = _blockMap.get(key);
        if (!list) { list = []; _blockMap.set(key, list); }
        list.push({ start, end, blockIdx });
    }
}

/**
 * Returns the display name of the line, or null if not found.
 * @param {string} lineCode
 * @returns {string|null}
 */
export function getLineLabel(lineCode) {
    if (!_lines) return null;
    return _lines[String(lineCode)]?.label ?? null;
}

/**
 * Returns the abbreviated block signaling type that is downstream (aval) of
 * the signal, taking direction into account.
 *
 * Returns null when:
 *   - the module has not been initialized yet,
 *   - lineCode is not in the block signaling dataset,
 *   - pk cannot be parsed as a valid SNCF PK string,
 *   - no segment covers the signal's PK in the given direction.
 *
 * When multiple segments overlap at a non-boundary PK (unusual), the first
 * match in insertion order is returned.
 *
 * @param {string} lineCode   App line code (e.g. '205000')
 * @param {string} milepost   SNCF milepost string, e.g. '069+350'
 * @param {string} direction  OSM direction value: 'forward', 'backward', or 'both'
 * @returns {string|null}
 */
export function getBlockType(lineCode, milepost, direction) {
    if (!_blockMap) return null;

    const pos = parseMilepostAsMeters(milepost);
    if (pos === null) return null;

    const segments = _blockMap.get(String(lineCode));
    if (!segments) return null;

    for (const { start, end, blockIdx } of segments) {
        if (_isSignalInSegment(pos, start, end, direction)) return _blockTypes[blockIdx] ?? null;
    }
    return null;
}


// ===== Private helpers =====

/**
 * Returns true when the signal position falls within the [start, end] block segment.
 * Boundary handling depends on the direction of travel (SNCF 'sens' field):
 *   'forward'  — the downstream block starts at pos: start ≤ pos < end
 *   'backward' — the downstream block ends at pos:   start < pos ≤ end
 *   other      — inclusive both ends; first match wins
 *
 * @param {number} pos    Signal position in meters
 * @param {number} start  Block segment start in meters
 * @param {number} end    Block segment end in meters
 * @param {string} dir    OSM direction: 'forward', 'backward', or other
 * @returns {boolean}
 */
function _isSignalInSegment(pos, start, end, dir) {
    if (dir === 'forward') return pos >= start && pos < end;
    if (dir === 'backward') return pos > start && pos <= end;
    return pos >= start && pos <= end;
}

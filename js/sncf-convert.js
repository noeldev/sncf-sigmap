/**
 * sncf-convert.js — Shared SNCF field conversion utilities.
 *
 * Converts raw SNCF open-data field values to the formats used by the
 * application (integer metres, decimal km strings) and to OSM tag values.
 *
 * This module has no dependencies and no side effects.
 *
 * Public API:
 *   parsePkAsMeters(raw)       — "077+305" → 77305  (integer metres, or null)
 *   pkToDecimalKm(raw)         — "077+305" → "77.305"  (OSM railway:position:exact)
 *   sensToOsmDirection(sens)   — "C" → "forward" | "D" → "backward"
 *   positionToOsmValue(raw)    — "A" → "bridge" | "D" → "right" | "G" → "left"
 */


/**
 * Parse a SNCF PK string of the form "077+305" into integer metres (77305).
 *
 * The _m suffix used in canton_segs data distinguishes these integer metre
 * values from the raw "km+m" PK strings stored in the signal tiles.
 * Returns null when raw is absent or does not match the expected format.
 *
 * @param {string} raw  e.g. "077+305" or "000-195"
 * @returns {number|null}
 */

export function parsePkAsMeters(raw) {
    if (!raw) return null;
    const m = raw.match(/^(\d+)([+-])(\d+)$/);
    if (!m) return null;
    return parseFloat(m[2] + m[1] + m[3]);
}


/**
 * Convert a SNCF PK string to the decimal km string used in the OSM tag
 * railway:position:exact (e.g. "077+305" → "77.305").
 *
 * Delegates to parsePkAsMeters so both functions share a single
 * implementation of the "km+m" format. Returns raw unchanged when the
 * format is unrecognised, and an empty string when raw is absent.
 *
 * @param {string} raw  e.g. "077+305"
 * @returns {string}
 */

export function pkToDecimalKm(raw) {
    const m = parsePkAsMeters(raw);
    if (m === null) return raw ?? '';
    return (m / 1000).toFixed(3);
}


/**
 * Convert a SNCF sens code to the OSM railway:signal:direction value.
 *   "C" (croissant)  → "forward"
 *   "D" (décroissant) → "backward"
 * Falls back to "forward" for absent or unrecognised values.
 *
 * @param {string} sens
 * @returns {string}
 */
export function sensToOsmDirection(sens) {
    return { C: 'forward', D: 'backward' }[sens] ?? 'forward';
}

/**
 * Convert a SNCF position code to the OSM railway:signal:position value.
 *   "A" → "bridge"
 *   "D" → "right"
 *   "G" → "left"
 * Returns raw unchanged for unrecognised values, and an empty string when absent.
 *
 * @param {string} raw
 * @returns {string}
 */
export function positionToOsmValue(raw) {
    return { A: 'bridge', D: 'right', G: 'left' }[raw] ?? (raw ?? '');
}

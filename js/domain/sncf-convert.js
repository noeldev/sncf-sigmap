// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * sncf-convert.js — SNCF raw data normalization and conversion utilities.
 *
 * Single point of contact between raw SNCF open-data field names/values
 * and the rest of the application. Call normalizeSignal() once per feature
 * in tiles.worker.js immediately after tile load.
 *
 * All downstream code (tooltip.js, signal-popup.js, filters.js,
 * signal-mapping.js) uses only the English normalized names and values —
 * no SNCF field names or coded values leak past this boundary.
 *
 * This module has no dependencies and no side effects.
 *
 * Public API:
 *   normalizeSignal(raw)          — maps SNCF fields to English app names/values
 *   parseKmPointAsMeters(raw)     — "077+305" → 77305  (integer meters, or null)
 *   kmPointToDecimalKm(raw)       — "077+305" → "77.305"  (OSM railway:position:exact)
 *
 * Note: direction and placement are already in OSM notation after normalization
 * ('forward'|'backward'|'both'  and  'right'|'left'|'bridge'), so no additional
 * conversion is needed for OSM tag export.
 *
 * ===== Early normalization =====
 *
 * SNCF tile field  → App field        Notes
 * ------------------------------------------------------------------
 * type_if          → signalType       SNCF signal category code
 * code_ligne       → lineCode         6-digit SNCF line identifier
 * code_voie        → trackCode        Track identifier on the line
 * nom_voie         → trackName        Track display name
 * sens             → direction        C→forward  D→backward  B→both
 * position         → placement        D→right    G→left      A→bridge
 * pk               → kmPoint          SNCF format "123+456" (kilometric point, French PK)
 * idreseau         → networkId        SNCF network unique identifier
 *
 * Direction and placement are stored in their OSM notation so that
 * signal-mapping.js can use them directly when building OSM tags.
 * Display translations use these same values as keys:
 *   t('values.direction.forward')  → "Increasing" | "Croissant"
 *   t('values.placement.right')    → "Right"      | "Droite"
 */

const DIR = { C: 'forward', D: 'backward', B: 'both' };
const PLACE = { D: 'right', G: 'left', A: 'bridge' };

/**
 * Return a new object with SNCF property names and coded values replaced by
 * English app names and OSM notation values. Call once per feature in
 * tiles.worker.js — never call twice on the same object.
 *
 * @param {object} raw  Raw signal feature properties from tile JSON
 * @returns {object}    Normalized properties with English field names and OSM values
 */
export function normalizeSignal(raw) {
    return {
        signalType: raw.type_if ?? '',
        lineCode: raw.code_ligne ?? '',
        trackCode: raw.code_voie ?? '',
        trackName: raw.nom_voie ?? '',
        direction: DIR[raw.sens] ?? 'unknown',
        placement: PLACE[raw.position] ?? 'unknown',
        kmPoint: raw.pk ?? '',
        networkId: raw.idreseau ?? '',
    };
}


/* ===== Kilometric point (KP) conversion =====
 *
 * The kilometric point is the SNCF point kilometrique (PK), stored in
 * signal tiles as a string in the format "km+m" or "km-m" (e.g. "137+722",
 * "000-195"). The sign separates kilometers from additional meters.
 */

const RE_KM_POINT = /^(\d+)([+-])(\d+)$/;

/**
 * Parse a SNCF kilometric point string of the form "077+305" into integer meters (77305).
 *
 * The _m suffix used in block_segments data distinguishes these integer meter
 * values from the raw kilometric point strings stored in the signal tiles.
 * Returns null when raw is absent or does not match the expected format.
 *
 * @param {string} raw  e.g. "077+305" or "000-195"
 * @returns {number|null}
 */
export function parseKmPointAsMeters(raw) {
    if (!raw) return null;
    const m = raw.match(RE_KM_POINT);
    if (!m) return null;
    return parseInt(m[2] + m[1] + m[3]);
}

/**
 * Convert a SNCF kilometric point string to the decimal km string used in the OSM
 * tag railway:position:exact (e.g. "077+305" → "77.305").
 *
 * Delegates to parseKmPointAsMeters so both functions share a single
 * implementation of the kilometric point format. Returns raw unchanged when the
 * format is unrecognized, and an empty string when raw is absent.
 *
 * @param {string} raw  e.g. "077+305"
 * @returns {string}
 */
export function kmPointToDecimalKm(raw) {
    const m = parseKmPointAsMeters(raw);
    if (m === null) return raw ?? '';
    return (m / 1000).toFixed(3);
}

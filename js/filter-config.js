/**
 * filter-config.js — Canonical registry of filter field definitions.
 *
 * Single source of truth for every filterable field: its key, UI metadata,
 * and sort/search behavior. Deliberately imports nothing from filters.js or
 * signal-data.js to avoid circular dependencies.
 *
 * Both layers import from here:
 *   - filters.js  → ALL_FILTER_FIELDS, getFilterFieldKeys() for UI construction
 *   - signal-data.js → getFilterFieldKeys() for getFilterData() scoping
 *   - filter-data.js → getFilterFieldKeys() for field-state initialization
 *
 * Adding a new filterable field means editing this file only.
 * No other file needs to be updated to make the data layer aware of the addition.
 *
 * Analogous to SIGNAL_MAPPING / getSupportedTypes() in signal-mapping.js:
 * the registry object is the data, getFilterFieldKeys() is the accessor.
 *
 * Public API:
 *   FILTER_FIELDS_META   — ordered metadata object, keyed by field key string.
 *   getFilterFieldKeys() — ordered array of field key strings.
 */

import { FIELD } from './field-keys.js';
import { MIN_SEARCH_THRESHOLD } from './config.js';

/**
 * Ordered map of field key → UI + behavior metadata.
 *
 * Order determines the order in which fields appear in the "Add filter" menu
 * and in which data is initialized in filter-data.js.
 *
 * Metadata properties (all optional unless noted):
 *   labelKey        {string}   — required. i18n key for the field label.
 *   labelSearch     {boolean}  — enables combined code+label search (lineCode).
 *   numericOnly     {boolean}  — restricts input to digits.
 *   readOnly        {boolean}  — field value comes from a closed list; no free text.
 *   valueOrder      {string[]} — explicit sort order for dropdown items.
 *   globalSearch    {boolean}  — searches the full index.json table, not tile data.
 *   searchThreshold {number}   — min-char threshold before showing suggestions.
 */
export const FILTER_FIELDS_META = Object.freeze({
    [FIELD.SIGNAL_TYPE]: {
        labelKey: 'fields.signalType',
    },
    [FIELD.LINE_CODE]: {
        labelKey: 'fields.lineCode',
        // labelSearch: true enables combined code+label search and tag tooltips.
        // numericOnly is intentionally absent: the input must accept label text.
        labelSearch: true,
    },
    [FIELD.TRACK_NAME]: {
        labelKey: 'fields.trackName',
    },
    [FIELD.DIRECTION]: {
        labelKey: 'fields.direction',
        valueOrder: ['backward', 'forward', 'both'],
        readOnly: true,
    },
    [FIELD.PLACEMENT]: {
        labelKey: 'fields.placement',
        valueOrder: ['left', 'right', 'bridge'],
        readOnly: true,
    },
    [FIELD.NETWORK_ID]: {
        labelKey: 'fields.networkId',
        numericOnly: true,
        globalSearch: true,
        searchThreshold: MIN_SEARCH_THRESHOLD,
    },
});

/**
 * Return the ordered list of filterable field keys.
 * Analogous to getSupportedTypes() in signal-mapping.js.
 * Preserves insertion order — callers must not sort or filter the result.
 * @returns {string[]}
 */
export function getFilterFieldKeys() {
    return Object.keys(FILTER_FIELDS_META);
}

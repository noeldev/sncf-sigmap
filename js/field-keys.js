/**
 * field-keys.js — Canonical field key string constants.
 *
 * Single source of truth for all field identifiers used across the app:
 *   - ALL_FILTER_FIELDS keys in filters.js
 *   - clipboard dataType in filter-panel.js, pins.js, and clipboard.js
 *   - data-field attribute selectors in signal-popup.js
 *   - getFilterData() return keys in signal-data.js
 *
 * HTML data-field attributes in index.html must match these values by convention.
 * JS code must import from here rather than using string literals so that any
 * future key rename only requires editing this file.
 *
 * FIELD properties are split into two groups:
 *   - Filterable: keys that appear in ALL_FILTER_FIELDS and can be used as
 *     clipboard dataType values for Copy / Paste between filter panels.
 *   - Display-only: keys present in popup data rows but not in ALL_FILTER_FIELDS.
 */

export const FIELD = Object.freeze({
    // ===== Filterable fields (keys in ALL_FILTER_FIELDS) =====
    SIGNAL_TYPE: 'signalType',
    LINE_CODE:   'lineCode',
    TRACK_NAME:  'trackName',
    DIRECTION:   'direction',
    PLACEMENT:   'placement',
    NETWORK_ID:  'networkId',

    // ===== Display-only fields (popup rows, not filterable) =====
    LINE_NAME:   'lineName',
    BLOCK_TYPE:  'blockType',
    TRACK_CODE:  'trackCode',
    MILEPOST:    'milepost',
    COORDS:      'coords',
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * group-mapping.js — Application signal display groups and legend colors.
 *
 * A "group" is an application-level display category: one entry per legend
 * color. It maps to the 'group' field in signal-types.js.
 *
 * This is distinct from the OSM "cat" (railway:signal:<cat>=*), which is the
 * OpenRailwayMap tagging sub-key defined as a string literal in signal-types.js.
 *
 * Only the UNSUPPORTED key needs a named constant — it is referenced in two
 * places (as a GROUP_INFO key and as the fallback in getColorForGroup). All
 * other group keys appear exactly once as string literals in GROUP_INFO.
 *
 * Public API:
 *   getColorForGroup(groupKey)  - hex color string for a group key
 *   getGroupEntries()           - all [groupKey, color] pairs for legend iteration
 *   getUnsupportedGroup()       - the fallback group key for unknown types
 */

// Only named because it is used in two places: GROUP_INFO key + fallback.
const UNSUPPORTED = 'unsupported';

// One color per group value — single source of truth for the legend palette.
const GROUP_INFO = {
    'main': '#e00000',
    'distant': '#ffc010',
    'speedLimit': '#ff8000',
    'route': '#00b0d0',
    'trainProtection': '#4060c0',
    'electricity': '#a00060',
    'wrongRoad': '#00a0a0',
    'crossing': '#b09000',
    'stop': '#f040b0',
    'station': '#008040',
    'shunting': '#a050e0',
    'miscellaneous': '#a0b0c0',
    [UNSUPPORTED]: '#607070',
};

/**
 * Return the hex color for a display group key.
 * Falls back to the UNSUPPORTED color when the key is not recognized.
 * @param {string} groupKey  e.g. 'main', 'distant'
 * @returns {string}
 */
export function getColorForGroup(groupKey) {
    return GROUP_INFO[groupKey] ?? GROUP_INFO[UNSUPPORTED];
}

/**
 * Return all [groupKey, color] pairs in legend display order.
 * @returns {[string, string][]}
 */
export function getGroupEntries() {
    return Object.entries(GROUP_INFO);
}

/**
 * Return the fallback group key for signal types with no known mapping.
 * @returns {string}
 */
export function getUnsupportedGroup() {
    return UNSUPPORTED;
}

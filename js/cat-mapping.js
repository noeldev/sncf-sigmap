/**
 * cat-mapping.js — Application signal categories and display colors.
 *
 * Owns the single source of truth for what each signal category looks like
 * in the application (color swatch, i18n key). Has no dependency on
 * signal-mapping.js so the color palette can be consulted independently.
 *
 * Public API:
 *   getColorForCategory(categoryKey)  — color hex string for a category key
 *   getCategoryEntries()              — all [key, color] pairs for iteration
 */


// Application display categories — color palette.
// Keys are referenced by the 'group' field in signal-mapping.js _SIGNAL_MAPPING.
// Private; external modules use getColorForCategory() / getCategoryEntries().
const CATEGORY_INFO = {
    'main':             '#e00000',
    'distant':          '#ffc010',
    'speedLimit':       '#ff8000',
    'route':            '#00b0d0',
    'trainProtection':  '#4060c0',
    'electricity':      '#a00060',
    'wrongRoad':        '#00a0a0',
    'crossing':         '#b09000',
    'stop':             '#f040b0',
    'station':          '#008040',
    'shunting':         '#a050e0',
    'miscellaneous':    '#a0b0c0',
    'unsupported':      '#607070',
};


/**
 * Return the hex color string for the given application category key.
 * Falls back to the 'unsupported' color when the key is not recognized.
 *
 * @param {string} categoryKey  e.g. "main", "distant"
 * @returns {string}
 */
export function getColorForCategory(categoryKey) {
    return CATEGORY_INFO[categoryKey] ?? CATEGORY_INFO['unsupported'];
}

/**
 * Return all category entries as [key, color] pairs.
 * Used by app.js to build the legend without direct access to CATEGORY_INFO.
 *
 * @returns {[string, string][]}
 */
export function getCategoryEntries() {
    return Object.entries(CATEGORY_INFO);
}

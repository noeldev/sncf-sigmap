/**
 * cat-mapping.js — Application signal categories, display colours, and legend.
 *
 * Owns the single source of truth for what each signal category looks like
 * in the application (colour swatch, i18n key). Has no dependency on
 * signal-mapping.js so the colour palette can be consulted independently.
 *
 * Public API:
 *   getColorForCategory(categoryKey)  — colour hex string for a category key
 *   getCategoryEntries()              — all [key, color] pairs for iteration
 *   buildLegend()                     — populate #legend-body in the DOM
 */


// Application display categories — colour palette.
// Keys are referenced by the 'group' field in signal-mapping.js _SIGNAL_MAPPING.
// Private; external modules use getColorForCategory() / getCategoryEntries().
const _CATEGORY_INFO = {
    'main':             '#e00000',
    'distant':          '#ffc010',
    'speed_limit':      '#ff8000',
    'route':            '#00b0d0',
    'train_protection': '#4060c0',
    'electricity':      '#a00060',
    'wrong_road':       '#00a0a0',
    'crossing':         '#b09000',
    'stop':             '#f040b0',
    'station':          '#008040',
    'shunting':         '#a050e0',
    'miscellaneous':    '#a0b0c0',
    'unsupported':      '#607070',
};


/**
 * Return the hex colour string for the given application category key.
 * Falls back to the 'unsupported' colour when the key is not recognised.
 *
 * @param {string} categoryKey  e.g. "main", "distant"
 * @returns {string}
 */
export function getColorForCategory(categoryKey) {
    return _CATEGORY_INFO[categoryKey] ?? _CATEGORY_INFO['unsupported'];
}

/**
 * Return all category entries as [key, color] pairs.
 * Used by buildLegend and any consumer that needs to iterate categories
 * without direct access to _CATEGORY_INFO.
 *
 * @returns {[string, string][]}
 */
export function getCategoryEntries() {
    return Object.entries(_CATEGORY_INFO);
}

/**
 * Populate #legend-body with one colour row per category.
 * Each row carries a data-i18n key of the form "cat.<key>" so the i18n
 * module can translate the label on language change.
 * Called once from app.js; safe to call again on language change.
 */
export function buildLegend() {
    const container = document.getElementById('legend-body');
    const tpl       = document.getElementById('tpl-legend-row');
    if (!container || !tpl) return;

    container.replaceChildren();

    for (const [key, color] of getCategoryEntries()) {
        const row = tpl.content.cloneNode(true).querySelector('.panel-row');
        row.querySelector('.legend-dot').style.backgroundColor = color;
        row.querySelector('.legend-label').dataset.i18n = `cat.${key}`;
        container.appendChild(row);
    }
}

/**
 * legend.js — Legend panel DOM builder and category filter shortcuts.
 *
 * Builds one <button> per signal category from cat-mapping and signal-mapping.
 * Wires each enabled button to filterByGroup in filters.js.
 * Exposes updateLegendIndicator() so the sidebar can sync the active-category
 * highlight after every filter change.
 *
 * Unsupported categories (no mapped signal types) receive the disabled
 * attribute — hover, click, and keyboard activation are suppressed natively.
 *
 * Public API:
 *   initLegend()            — build DOM and wire buttons; call once from sidebar.js.
 *   updateLegendIndicator() — sync .is-active class with the current group preset.
 */

import { getCategoryEntries } from './cat-mapping.js';
import { getTypesByGroup } from './signal-mapping.js';
import { filterByGroup, getActiveGroup } from './filters.js';
import { onLangChange, translateElement } from './translation.js';

/**
 * Build the legend DOM and wire category buttons.
 * Registers a language-change listener to rebuild button titles.
 */
export function initLegend() {
    _buildLegend();
    // Rebuild on language change so data-i18n-title attributes are re-applied.
    onLangChange(_buildLegend);
}

/**
 * Sync the .is-active class on legend buttons with the current group preset.
 * Called by sidebar.js after every filter change.
 */
export function updateLegendIndicator() {
    const group = getActiveGroup();
    document.querySelectorAll('.legend-item[data-type]').forEach(item => {
        item.classList.toggle('is-active', item.dataset.type === group);
    });
}


/* ===== Private ===== */

/**
 * Populate #legend-body with one <button> per category.
 * Clears existing content first so it is safe to call on language change.
 */
function _buildLegend() {
    const container = document.getElementById('legend-body');
    const tpl = document.getElementById('tpl-legend-row');
    if (!container || !tpl) return;

    container.replaceChildren();

    for (const [key, color] of getCategoryEntries()) {
        const btn = tpl.content.cloneNode(true).querySelector('.legend-item');
        btn.dataset.type = key;
        btn.querySelector('.legend-dot').style.backgroundColor = color;
        btn.querySelector('.legend-label').dataset.i18n = `cat.${key}`;

        if (getTypesByGroup(key).length === 0) {
            btn.disabled = true;
        } else {
            // data-i18n-title is translated by translateAll on lang change.
            btn.dataset.i18nTitle = 'legend.clickToFilter';
            btn.addEventListener('click', () => filterByGroup(key));
        }

        container.appendChild(btn);
        translateElement(btn);
    }
}

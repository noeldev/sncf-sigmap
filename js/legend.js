/**
 * legend.js — Legend panel DOM builder and category filter shortcuts.
 *
 * Builds one <button> per signal category from cat-mapping and signal-mapping.
 * Wires each enabled button to filterByGroup in filters.js.
 * Exposes updateLegendIndicator() so the sidebar can sync the active-category
 * highlight after every filter change.
 *
 * Public API:
 *   initLegend()            — build DOM and wire buttons; call once from sidebar.js.
 *   updateLegendIndicator() — sync .is-active class with the current group preset.
 */

import { getCategoryEntries } from './cat-mapping.js';
import { getTypesByGroup } from './signal-mapping.js';
import { filterByGroup, getActiveGroup } from './filters.js';
import { t, onLangChange } from './translation.js';

/**
 * Build the legend DOM and wire category buttons.
 * Registers a language-change listener to rebuild button titles.
 */
export function initLegend() {
    _buildLegend();

    // Single delegated click on the container — survives replaceChildren() in _buildLegend.
    document.getElementById('legend-body')?.addEventListener('click', e => {
        const btn = e.target.closest('.legend-item[data-type]');
        if (btn) filterByGroup(btn.dataset.type);
    });

    // Rebuild on language change and re-sync the active-group indicator.
    onLangChange(() => {
        _buildLegend();
        updateLegendIndicator();
    });
}

/**
 * Sync the .is-active class on legend buttons with the current group preset,
 * and update the summary color dot shown when the legend panel is collapsed.
 * Called by sidebar.js after every filter change and after lang-change rebuild.
 */
export function updateLegendIndicator() {
    const group = getActiveGroup();
    let activeColor = null;
    let activeLabel = null;

    document.querySelectorAll('.legend-item[data-type]').forEach(item => {
        const isActive = item.dataset.type === group;
        item.classList.toggle('is-active', isActive);
        if (isActive) {
            activeColor = item.querySelector('.legend-dot')?.style.backgroundColor ?? null;
            activeLabel = item.querySelector('.legend-label')?.textContent ?? null;
        }
    });

    // Show a color dot in the panel summary when a category is active.
    const dot = document.querySelector('#legend-panel .legend-summary-dot');
    if (!dot) return;
    if (activeColor) {
        dot.style.setProperty('--legend-dot-color', activeColor);
        dot.title = activeLabel ?? '';
        dot.classList.remove('is-hidden');
    } else {
        dot.style.removeProperty('--legend-dot-color');
        dot.title = '';
        dot.classList.add('is-hidden');
    }
}


// ===== Private helpers =====

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
        btn.querySelector('.legend-label').textContent = t(`cat.${key}`);
        btn.title = t('legend.clickToFilter');

        container.appendChild(btn);
    }
}

/**
 * sidebar.js — Sidebar UI orchestration.
 *
 * Owns all sidebar-DOM-related initialisation:
 *   - Collapsible panels (cp-panel).
 *   - Language picker dropdown.
 *   - Tab switching (Filters / Settings / About).
 *   - Legend (delegated to legend.js).
 *   - Filter panels and Reset button (delegated to filters.js).
 *   - Pinned signals panel (delegated to pins.js).
 *   - JOSM detection panel (lazy-loaded on first Settings tab open).
 *
 * No map state, no tile data, no worker interaction.
 *
 * Public API:
 *   initSidebar({ onRefresh })
 *     onRefresh({ filterCount? }) — called after filter changes.
 */

import { t } from './translation.js';
import {
    getAutoTagsTab, setAutoTagsTab,
    getSkipJosmConfirm, setSkipJosmConfirm,
    getRememberPosition, setRememberPosition,
} from './prefs.js';
import { closeAll as closeAllDropdowns } from './ui/dropdown.js';
import { initCollapsiblePanels, openPanel } from './collapsible-panel.js';
import { initLangPicker } from './lang-picker.js';
import { initLegend, updateLegendIndicator } from './legend.js';
import {
    initFilters, resetFilters,
    hasAnyFilters, getActiveFilterCount
} from './filters.js';
import { initFilterToolbar, updateFilterToolbar } from './filter-toolbar.js';
import { initPins } from './pins.js';


// ===== Module state =====

/** Map-level refresh callback provided by app.js at init time. */
let _onRefresh = null;


// ===== Public API =====

/**
 * Initialize all sidebar UI components.
 * Must be called after the DOM is ready and initMap() has resolved
 * (refreshBasemapLabels needs the tile layers to exist).
 *
 * @param {object}   opts
 * @param {Function} opts.onRefresh  Called after any filter change that needs a map refresh.
 *                                   Receives { filterCount?: number }.
 */
export function initSidebar({ onRefresh }) {
    _onRefresh = onRefresh;
    initCollapsiblePanels();
    initLangPicker();
    initLegend();

    _initTabs();
    _initTabLinks();
    _initBehaviorToggles();
    _initFilters();
    _initResetButton();
    _initPins();
}


// ===== Pinned signals panel =====

/**
 * Initialise the pinned signals panel immediately so saved pins are visible
 * before the filter index loads. flyToSignal handles missing index gracefully.
 */
function _initPins() {
    initPins({ container: document.getElementById('pinned-container') });
}


// ===== Filters =====

function _initFilters() {
    initFilters(_onFiltersChange);
    initFilterToolbar();
}

/**
 * Called by filters.js after every filter state change.
 * Updates sidebar UI then notifies app.js via _onRefresh.
 */
function _onFiltersChange() {
    _updateResetButton();
    updateLegendIndicator();
    updateFilterToolbar();
    _onRefresh({ filterCount: getActiveFilterCount() });
}

/** Sync the Reset button's disabled state with whether any filters are active. */
function _updateResetButton() {
    const btn = document.getElementById('btn-reset-filters');
    if (btn) btn.disabled = !hasAnyFilters();
}

/**
 * Wire the Reset button.
 * The button is only enabled when filters are active, so confirmation
 * is always appropriate when reachable.
 */
function _initResetButton() {
    _updateResetButton();
    document.getElementById('btn-reset-filters')
        ?.addEventListener('click', _onResetFilters);
}

function _onResetFilters() {
    if (!confirm(t('buttons.confirmReset'))) return;
    resetFilters();
}


// ===== Behavior toggles =====

// Checkbox id → [getter, setter] — single source of truth for behavior toggle wiring.
const TOGGLE_PREFS = {
    'chk-auto-tags-tab': [getAutoTagsTab, setAutoTagsTab],
    'chk-skip-josm-confirm': [getSkipJosmConfirm, setSkipJosmConfirm],
    'chk-remember-position': [getRememberPosition, setRememberPosition],
};

function _initBehaviorToggles() {
    // Initialize checked states.
    for (const [id, [getter]] of Object.entries(TOGGLE_PREFS)) {
        const el = document.getElementById(id);
        if (el) el.checked = getter();
    }
    // Single delegated change listener on the behavior panel body.
    document.getElementById('settings-behavior-panel-body')?.addEventListener('change', e => {
        const pair = TOGGLE_PREFS[e.target.id];
        if (pair) pair[1](e.target.checked);
    });
}


// ===== Tabs =====

/**
 * Activate a tab panel by its element ID (e.g. 'tab-settings').
 * Updates ARIA attributes, active classes, and triggers side-effects.
 * @param {string} tabId
 */
function _switchToTab(tabId) {
    closeAllDropdowns();

    document.querySelectorAll('.stab').forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    const tab = document.querySelector(`.stab[aria-controls="${tabId}"]`);
    if (!tab) return;
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(tabId)?.classList.add('active');

    if (tabId === 'tab-settings') _refreshJosmStatus();
}

function _initTabs() {
    // Single delegated click on #sidebar-tabs handles all tab buttons.
    document.getElementById('sidebar-tabs')?.addEventListener('click', e => {
        const tab = e.target.closest('.stab');
        if (tab) _switchToTab(tab.getAttribute('aria-controls'));
    });
}

/**
 * Register a delegated click handler for [label](#tab-id) links.
 *
 * Attaches a single listener on document that intercepts clicks on any element
 * carrying a data-switch-tab attribute and forwards the tab ID to the callback.
 * Delegation is required because the links are created dynamically by
 * translateAll() and do not exist in the DOM when initSidebar() runs.
 */
function _initTabLinks() {
    document.addEventListener('click', e => {
        // [label](#tab-id) links — switch to the target tab.
        const tabLink = e.target.closest('[data-switch-tab]');
        if (tabLink) {
            e.preventDefault();
            _switchToTab(tabLink.dataset.switchTab);
            return;
        }
        // [label](#panel:id) links — open and scroll to a collapsible panel.
        const panelLink = e.target.closest('[data-scroll-panel]');
        if (panelLink) {
            e.preventDefault();
            const panel = document.getElementById(panelLink.dataset.scrollPanel);
            if (!panel) return;
            openPanel(panel);
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}


// ===== JOSM detection panel =====

async function _refreshJosmStatus() {
    const body = document.getElementById('josm-detect-body');
    if (!body) return;

    body.dataset.josmStatus = 'checking';

    try {
        const { josmGetVersion } = await import('./josm.js');
        const result = await josmGetVersion();
        body.dataset.josmStatus = result.status;
        if (result.status === 'ok') _updateJosmFields(result);
    } catch {
        body.dataset.josmStatus = 'error';
    }
}

/**
 * Populate the JOSM detection panel with detected version info.
 * @param {object} opts
 * @param {string} opts.version
 * @param {number} opts.protocolMajor
 * @param {number} opts.protocolMinor
 * @param {number} opts.port
 */
function _updateJosmFields({ version, protocolMajor, protocolMinor, port }) {
    document.getElementById('josm-val-version').textContent = version;
    document.getElementById('josm-val-protocol').textContent = `${protocolMajor}.${protocolMinor}`;
    document.getElementById('josm-val-port').textContent = port;
}

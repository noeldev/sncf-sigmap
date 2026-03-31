/**
 * sidebar.js — Sidebar UI orchestration.
 *
 * Responsibilities:
 *   - Language picker dropdown (flag, label, activation, keyboard nav).
 *   - Tab switching (Filters / Settings / About).
 *   - JOSM detection panel (lazy-loaded on first Settings tab open).
 *
 * All logic here is purely sidebar-DOM-related.
 * No map state, no tile data, no worker interaction.
 *
 * Public API:
 *   initSidebar()  — wire all sidebar UI; called once from app.js/_boot().
 */

import { getLang, setLang, buildLangOptions, onLangChange, initTabLinks } from './translation.js';
import {
    getAutoTagsTab, setAutoTagsTab,
    getSkipJosmConfirm, setSkipJosmConfirm,
    getRememberPosition, setRememberPosition,
} from './prefs.js';
import { refreshBasemapLabels } from './map.js';
import { Dropdown, closeAll as closeAllDropdowns } from './ui/dropdown.js';


/**
 * Initialize all sidebar UI components.
 * Must be called after the DOM is ready and initMap() has resolved
 * (refreshBasemapLabels() needs the tile layers to exist).
 */
export function initSidebar() {
    _initLangPicker();
    _initTabs();
    _initBehaviorToggles();
    _initTabLinks();
    // Rebuild basemap labels on language change — basemap buttons are
    // generated at runtime and don't carry data-i18n attributes.
    onLangChange(refreshBasemapLabels);
}


// ===== Behavior toggles =====

function _initBehaviorToggles() {
    _initToggle('chk-auto-tags-tab', getAutoTagsTab, setAutoTagsTab);
    _initToggle('chk-skip-josm-confirm', getSkipJosmConfirm, setSkipJosmConfirm);
    _initToggle('chk-remember-position', getRememberPosition, setRememberPosition);
}

/**
 * Bind a checkbox to a preference getter/setter.
 * Sets the initial checked state from the stored preference and
 * updates the preference on every change.
 * @param {string}             id      — Element ID of the checkbox.
 * @param {function(): boolean} getter — Returns the current stored value.
 * @param {function(boolean): void} setter — Persists the new value.
 */
function _initToggle(id, getter, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = getter();
    el.addEventListener('change', () => setter(el.checked));
}


// ===== Language picker =====

function _initLangPicker() {
    const dropdown = document.getElementById('lang-dropdown');
    const btn = document.getElementById('lang-select-btn');
    if (!dropdown || !btn) return;

    // Populate options from _LANG_INFO — replaces any static HTML placeholders.
    buildLangOptions(dropdown);
    // tabindex:-1 keeps items out of the natural tab order while still allowing
    // programmatic focus from Dropdown keyboard navigation.
    dropdown.querySelectorAll('.lang-option').forEach(opt => opt.setAttribute('tabindex', '-1'));
    dropdown.classList.add('is-hidden');

    // Re-render the language button whenever the language changes.
    onLangChange(() => _updateLangButton(dropdown));

    // Passing input:btn gives Dropdown a focusInput() target so that:
    // - Escape in the list returns focus to the button.
    // - Shift+Tab on the first item returns focus to the button.
    // - Tab on the last item closes the dropdown.
    const langDd = new Dropdown({
        dropdownEl: dropdown,
        triggerEl: btn,
        input: btn,
        listEl: dropdown,
        itemSel: '.lang-option',
        onActivate: _activate,
        activationFocusMode: 'input',  // return focus to btn after selecting
    });

    async function _activate(val) {
        await setLang(val);   // calls translateAll → fires onLangChange listeners
        langDd.close();
    }

    // Mouse click on a list option.
    dropdown.addEventListener('mousedown', e => {
        const opt = e.target.closest('.lang-option');
        if (!opt) return;
        e.preventDefault();
        _activate(opt.dataset.val);
    });

    // Button: toggle open/close on click; open and focus active/first item on keyboard.
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = langDd.isOpen();
        closeAllDropdowns();
        if (!wasOpen) langDd.open();
    });

    btn.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!langDd.isOpen()) {
                closeAllDropdowns();
                langDd.open();
            }
            // Focus the currently-active locale option, or fall back to first.
            queueMicrotask(() => {
                const active = dropdown.querySelector('.lang-option.active');
                (active ?? dropdown.querySelector('.lang-option'))?.focus();
            });
        }
    });

    _updateLangButton(dropdown);
}

/**
 * Sync the language button flag + label with the current language,
 * and mark the active option in the dropdown.
 * @param {HTMLElement} dropdown — The language <ul> dropdown element.
 */
function _updateLangButton(dropdown) {
    const lang = getLang();
    const option = dropdown.querySelector(`[data-val="${lang}"]`);
    const flagEl = document.getElementById('lang-flag');
    const lblEl = document.getElementById('lang-label');

    if (flagEl && option) {
        const imgSrc = option.querySelector('img')?.src;
        let img = flagEl.querySelector('img');
        if (!img) {
            img = document.createElement('img');
            img.className = 'flag-img';
            flagEl.appendChild(img);
        }
        if (imgSrc) img.src = imgSrc;
        img.alt = option.querySelector('span')?.textContent || '';
    }
    if (lblEl && option) {
        lblEl.textContent = option.querySelector('span')?.textContent || lang;
    }

    dropdown.querySelectorAll('.lang-option').forEach(o =>
        o.classList.toggle('active', o.dataset.val === lang)
    );
}


// ===== Tabs =====

/**
 * Activate a tab panel by its element ID (e.g. 'tab-settings').
 * Updates ARIA attributes, active classes, and triggers side-effects
 * (dropdown close, JOSM status refresh on Settings).
 *
 * Used by both the tab click handler and the [[#tab-id]] link listener.
 *
 * @param {string} tabId — ID of the tab panel element, e.g. 'tab-settings'.
 */
function _switchToTab(tabId) {
    closeAllDropdowns();

    document.querySelectorAll('.stab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
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
    document.querySelectorAll('.stab').forEach(tab =>
        tab.addEventListener('click', () =>
            _switchToTab(tab.getAttribute('aria-controls'))
        )
    );
}

/**
 * Register the delegated [...](#tab-id) link listener via translation.js.
 *
 * initTabLinks() attaches a single click handler on document that intercepts
 * any element carrying [data-switch-tab]. This delegation pattern is required
 * because the links are created dynamically by translateAll() — they do not
 * exist in the DOM when initSidebar() runs.
 */
function _initTabLinks() {
    initTabLinks(tabId => _switchToTab(tabId));
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
 * Populate the JOSM detection panel fields with the detected version info.
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

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

import { getLang, setLang, buildLangOptions, onLangChange } from './translation.js';
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
    dropdown.classList.add('is-hidden');

    // Re-render the language button whenever the language changes.
    onLangChange(() => _updateLangButton(dropdown));

    const _activate = async (val) => {
        await setLang(val);   // calls translateAll → fires onLangChange listeners
        langDd.close();
    };

    const langDd = new Dropdown({
        panel: document.getElementById('lang-select-wrap'),
        dropdownEl: dropdown,
        triggerEl: btn,
        listEl: dropdown,
        itemSel: '.lang-option',
        onActivate: _activate,
    });

    dropdown.addEventListener('mousedown', e => {
        const opt = e.target.closest('.lang-option');
        if (!opt) return;
        e.preventDefault();
        _activate(opt.dataset.val);
    });

    btn.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = langDd.isOpen();
        closeAllDropdowns();
        if (!wasOpen) langDd.open();
    });

    _updateLangButton(dropdown);
}

/**
 * Sync the language button flag + label with the current language,
 * and mark the active option in the dropdown.
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
    if (lblEl && option) lblEl.textContent = option.querySelector('span')?.textContent || lang;

    dropdown.querySelectorAll('.lang-option').forEach(o =>
        o.classList.toggle('active', o.dataset.val === lang)
    );
}


// ===== Tabs =====

function _initTabs() {
    const tabs = document.querySelectorAll('.stab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab =>
        tab.addEventListener('click', () => {
            // Close any open dropdown before switching panels.
            closeAllDropdowns();

            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            panels.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');

            if (tab.dataset.tab === 'settings') _refreshJosmStatus();
        })
    );
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

/** Populate the JOSM detection panel with version/protocol/port values. */
function _updateJosmFields({ version, protocolMajor, protocolMinor, port }) {
    document.getElementById('josm-val-version').textContent = version;
    document.getElementById('josm-val-protocol').textContent = `${protocolMajor}.${protocolMinor}`;
    document.getElementById('josm-val-port').textContent = port;
}

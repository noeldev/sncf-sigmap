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

import { getLang, setLang, applyTranslations } from './i18n.js';
import { refreshBasemapLabels } from './map.js';
import { Dropdown, closeAll as closeAllDropdowns } from './ui/dropdown.js';


/**
 * Initialise all sidebar UI components.
 * Must be called after the DOM is ready and initMap() has resolved
 * (refreshBasemapLabels() needs the tile layers to exist).
 */
export function initSidebar() {
    _initLangPicker();
    _initTabs();
}


// ===== Language picker =====

function _initLangPicker() {
    const dropdown = document.getElementById('lang-dropdown');
    const btn = document.getElementById('lang-select-btn');
    if (!dropdown || !btn) return;

    // Start hidden — Dropdown controller manages visibility via .is-hidden.
    dropdown.classList.add('is-hidden');

    const _updateBtn = () => {
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
    };

    const _activate = (val) => {
        setLang(val);
        _updateBtn();
        refreshBasemapLabels();
        langDd.close();
    };

    // Dropdown handles: ARIA (aria-expanded, role=listbox, role=option),
    // keyboard navigation, and outside-click closing.
    const langDd = new Dropdown({
        panel: document.getElementById('lang-select-wrap'),
        dropdownEl: dropdown,
        triggerEl: btn,
        listEl: dropdown,
        itemSel: '.lang-option',
        onActivate: _activate,
    });

    // Mouse activation: delegate to list container to avoid per-item listeners.
    dropdown.addEventListener('mousedown', e => {
        const opt = e.target.closest('.lang-option');
        if (!opt) return;
        e.preventDefault();
        _activate(opt.dataset.val);
    });

    // Button click: close every other open dropdown, then toggle this one.
    // closeAllDropdowns() goes through the shared registry so each instance's
    // _open flag stays in sync with the DOM — unlike raw classList manipulation.
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = langDd.isOpen();
        closeAllDropdowns();
        if (!wasOpen) langDd.open();
    });
    // Outside-click closing handled by Dropdown's shared registry in dropdown.js.

    _updateBtn();
}


// ===== Tabs =====

function _initTabs() {
    document.querySelectorAll('.stab').forEach(tab =>
        tab.addEventListener('click', () => {
            // Close any open dropdown before switching panels so it doesn't
            // remain visible behind a different tab's content.
            closeAllDropdowns();
            document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
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

    const { josmGetVersion } = await import('./josm.js');
    const result = await josmGetVersion();
    body.dataset.josmStatus = result.status;

    if (result.status === 'ok') {
        document.getElementById('josm-val-version').textContent = result.version;
        document.getElementById('josm-val-protocol').textContent =
            `${result.protocolMajor}.${result.protocolMinor}`;
        document.getElementById('josm-val-port').textContent = result.port;
    }
}

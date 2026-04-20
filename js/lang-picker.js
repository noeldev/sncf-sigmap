/**
 * lang-picker.js — Language picker dropdown.
 *
 * Owns the language selector in the Settings tab: flag button, dropdown list,
 * keyboard navigation, and language button state sync.
 *
 * Responsibilities split across module-level private functions:
 *   _setupList       — populate options, set tabindex, hide initially
 *   _bindListMouse   — delegated mousedown on the list
 *   _bindButtonEvents — click + keydown on the trigger button
 *   _updateButton    — sync flag, label text, and active mark after lang change
 *
 * Public API:
 *   initLangPicker()  — wire the picker; call once from sidebar.js.
 */

import { getLang, setLang, buildLangOptions, onLangChange } from './translation.js';
import { Dropdown, closeAll as closeAllDropdowns } from './ui/dropdown.js';


// ===== Public API =====

/**
 * Wire the language picker dropdown.
 * Must be called after the DOM is ready.
 */
export function initLangPicker() {
    const dropdown = document.getElementById('lang-dropdown');
    const btn = document.getElementById('lang-select-btn');
    if (!dropdown || !btn) return;

    _setupList(dropdown);

    const dd = _createDropdown(dropdown, btn);
    _bindListMouse(dropdown, dd);
    _bindButtonEvents(btn, dropdown, dd);
    _updateButton(dropdown);

    onLangChange(() => _updateButton(dropdown));
}


// ===== Private helpers =====

function _createDropdown(dropdown, btn) {
    // _activate is module-level; dd is passed explicitly to avoid a closure.
    const dd = new Dropdown({
        dropdownEl: dropdown,
        triggerEl: btn,
        // Passing the button as input gives Dropdown a focusInput() target so
        // Escape in the list and Shift+Tab on the first item return focus here.
        input: btn,
        listEl: dropdown,
        itemSel: '.lang-option',
        onActivate: val => _activate(dd, val),
        activationFocusMode: 'input',
    });
    return dd;
}

/**
 * Populate options, make all items keyboard-focusable via Dropdown navigation
 * only (tabindex:-1), and hide the panel initially.
 * @param {HTMLElement} dropdown
 */
function _setupList(dropdown) {
    buildLangOptions(dropdown);
    dropdown.querySelectorAll('.lang-option')
        .forEach(opt => opt.setAttribute('tabindex', '-1'));
    dropdown.classList.add('is-hidden');
}

/**
 * Activate a language: persist the selection and close the dropdown.
 * Module-level so it carries no implicit state — dd is passed explicitly.
 * @param {Dropdown} dd
 * @param {string}   val
 */
async function _activate(dd, val) {
    await setLang(val);
    dd.close();
}

/**
 * Delegated mousedown on the list — handles option clicks.
 * mousedown instead of click so e.preventDefault() keeps focus on the button.
 * @param {HTMLElement} dropdown
 * @param {Dropdown}    dd
 */
function _bindListMouse(dropdown, dd) {
    dropdown.addEventListener('mousedown', e => {
        const opt = e.target.closest('.lang-option');
        if (!opt) return;
        e.preventDefault();
        _activate(dd, opt.dataset.val);
    });
}

/**
 * Wire click and keydown on the trigger button.
 *   click   — toggle open/close, closing any other open dropdown first.
 *   keydown — open + focus active option on ArrowDown / Enter / Space.
 * @param {HTMLElement} btn
 * @param {HTMLElement} dropdown
 * @param {Dropdown}    dd
 */
function _bindButtonEvents(btn, dropdown, dd) {
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = dd.isOpen();
        closeAllDropdowns();
        if (!wasOpen) dd.open();
    });

    btn.addEventListener('keydown', e => {
        if (e.key !== 'ArrowDown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (!dd.isOpen()) {
            closeAllDropdowns();
            dd.open();
        }
        // Focus the active locale option, or fall back to the first.
        queueMicrotask(() => {
            const active = dropdown.querySelector('.lang-option.active');
            (active ?? dropdown.querySelector('.lang-option'))?.focus();
        });
    });
}

/**
 * Sync the trigger button flag image + label text with the current language,
 * and mark the corresponding option as active in the dropdown list.
 * @param {HTMLElement} dropdown
 */
function _updateButton(dropdown) {
    const lang = getLang();
    const option = dropdown.querySelector(`[data-val="${lang}"]`);

    _updateFlag(option);
    _updateLabel(option, lang);
    _markActiveOption(dropdown, lang);
}

/**
 * Update the flag image inside #lang-flag.
 * Creates the <img> on first call; updates src/alt on subsequent calls.
 * @param {Element|null} option  The active .lang-option element, or null.
 */
function _updateFlag(option) {
    const flagEl = document.getElementById('lang-flag');
    if (!flagEl || !option) return;
    const imgSrc = option.querySelector('img')?.src;
    let img = flagEl.querySelector('img');
    if (!img) {
        img = Object.assign(document.createElement('img'), { className: 'flag-img' });
        flagEl.appendChild(img);
    }
    if (imgSrc) img.src = imgSrc;
    img.alt = option.querySelector('span')?.textContent ?? '';
}

/**
 * Update the text label inside #lang-label.
 * @param {Element|null} option
 * @param {string}       lang   Fallback when option is null.
 */
function _updateLabel(option, lang) {
    const lblEl = document.getElementById('lang-label');
    if (lblEl) lblEl.textContent = option?.querySelector('span')?.textContent ?? lang;
}

/**
 * Toggle the .active class on all lang-options to reflect the current lang.
 * @param {HTMLElement} dropdown
 * @param {string}      lang
 */
function _markActiveOption(dropdown, lang) {
    dropdown.querySelectorAll('.lang-option')
        .forEach(o => o.classList.toggle('active', o.dataset.val === lang));
}

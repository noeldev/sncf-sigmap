/**
 * lang-picker.js — Language picker dropdown.
 *
 * Owns the language selector in the Settings tab: flag button, dropdown list,
 * keyboard navigation, and language button state sync.
 *
 * Public API:
 *   initLangPicker()  — wire the picker; call once from sidebar.js.
 */

import { getLang, setLang, buildLangOptions, onLangChange } from './translation.js';
import { Dropdown, closeAll as closeAllDropdowns } from './ui/dropdown.js';


/**
 * Wire the language picker dropdown.
 * Must be called after the DOM is ready.
 */
export function initLangPicker() {
    const dropdown = document.getElementById('lang-dropdown');
    const btn = document.getElementById('lang-select-btn');
    if (!dropdown || !btn) return;

    buildLangOptions(dropdown);
    // tabindex:-1 keeps items out of the natural tab order while still allowing
    // programmatic focus from Dropdown keyboard navigation.
    dropdown.querySelectorAll('.lang-option').forEach(opt => opt.setAttribute('tabindex', '-1'));
    dropdown.classList.add('is-hidden');

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
        onActivate: _activateLang,
        activationFocusMode: 'input',
    });

    async function _activateLang(val) {
        await setLang(val);
        langDd.close();
    }

    // Mouse click on a list option.
    dropdown.addEventListener('mousedown', e => {
        const opt = e.target.closest('.lang-option');
        if (!opt) return;
        e.preventDefault();
        _activateLang(opt.dataset.val);
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


// ===== Private helpers =====

/**
 * Sync the language button flag + label with the current language,
 * and mark the active option in the dropdown.
 * @param {HTMLElement} dropdown
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

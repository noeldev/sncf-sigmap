/**
 * filter-toolbar.js — "Add filter" button and dropdown menu.
 *
 * filters.js provides the data and action callbacks at init time:
 *   getAvailableFields()  — returns [{ key, labelKey }] not yet in use.
 *   addFilterField(key)   — called when the user picks a field to add.
 *
 * Public API:
 *   initFilterToolbar(btn)
 *   updateFilterToolbar()
 */

import { t } from './translation.js';
import { getAvailableFields, addFilterField } from "./filters.js";

let _btn = null;

// Templates accessed lazily from the live DOM.
const _tpl = {
    get menu() { return document.getElementById('tpl-add-filter-menu'); },
    get option() { return document.getElementById('tpl-add-filter-option'); },
};


/**
 * Wire the Add filter button to its dropdown menu.
 * Retrieves #btn-add-filter directly — its location in the DOM is fixed.
 */
export function initFilterToolbar() {
    const btn = document.getElementById('btn-add-filter');
    if (!btn) return;
    _btn = btn;

    btn.addEventListener('click', _onBtnClick);
    btn.addEventListener('keydown', _onBtnKeydown);

    // Dismiss the menu when clicking outside it.
    document.addEventListener('click', e => {
        if (!e.target.closest('.add-filter-menu') && !e.target.closest('#btn-add-filter'))
            document.querySelector('.add-filter-menu')?.remove();
    });

    updateFilterToolbar();
}

/**
 * Sync the Add button's disabled state.
 * Call this after any change to the set of active filter panels.
 */
export function updateFilterToolbar() {
    if (!_btn) return;
    _btn.disabled = getAvailableFields().length === 0;
}


// ===== Private helpers =====

function _onBtnClick(e) {
    e.stopPropagation();
    const existing = document.querySelector('.add-filter-menu');
    if (existing) {
        existing.remove();
        _btn.focus();
        return;
    }
    const menu = _buildMenu();
    if (menu) {
        (document.fullscreenElement ?? document.body).appendChild(menu);
        menu.querySelector('.afm-option')?.focus();
    }
}

function _onBtnKeydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        if (document.querySelector('.add-filter-menu')) return;
        e.preventDefault();
        _btn.click();
    }
}

/**
 * Build the floating dropdown menu positioned below the Add button.
 * Returns null when no fields are available.
 */
function _buildMenu() {
    const available = getAvailableFields();
    if (!available.length) return null;

    const menu = _tpl.menu.content.cloneNode(true).querySelector('.add-filter-menu');
    const r = _btn.getBoundingClientRect();
    Object.assign(menu.style, {
        position: 'fixed',
        top: (r.bottom + 4) + 'px',
        left: r.left + 'px',
        zIndex: '9999',
    });

    for (const f of available) {
        const opt = _tpl.option.content.cloneNode(true).querySelector('.afm-option');
        opt.textContent = t(f.labelKey);
        opt.dataset.key = f.key;
        menu.appendChild(opt);
    }
    menu.setAttribute('role', 'menu');

    // Delegated mousedown — activates the option under the pointer.
    menu.addEventListener('mousedown', e => {
        const opt = e.target.closest('.afm-option');
        if (!opt) return;
        e.preventDefault();
        _activateKey(opt.dataset.key, menu);
    });

    // Delegated keydown — activates or navigates all options.
    menu.addEventListener('keydown', e => {
        const opt = e.target.closest('.afm-option');
        switch (e.key) {
            case 'Enter':
            case ' ':
                if (!opt) return;
                e.preventDefault();
                _activateKey(opt.dataset.key, menu);
                break;
            case 'ArrowDown':
                e.preventDefault();
                (opt?.nextElementSibling ?? menu.firstElementChild)?.focus();
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (!opt?.previousElementSibling) {
                    menu.remove();
                    _btn.focus();
                }
                else {
                    opt.previousElementSibling?.focus();
                }
                break;
            case 'Escape':
            case 'Tab':
                e.preventDefault();
                menu.remove();
                _btn.focus();
                break;
        }
    });

    return menu;
}

function _activateKey(key, menu) {
    addFilterField(key);
    menu.remove();
    _btn.focus();
}

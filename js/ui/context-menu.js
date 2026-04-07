/**
 * ui/context-menu.js — Floating context menu for map markers.
 *
 * Uses <template> elements from index.html and event delegation on the menu.
 * Closes on Escape, outside mousedown, map movestart, or closeContextMenu().
 *
 * Public API:
 *   showContextMenu(x, y, items)  — show menu at viewport coords.
 *   closeContextMenu()            — dismiss any open menu.
 *
 * Item shape: { labelKey: string, shortcut?: string, action: Function }
 * Separator:  the string 'separator'
 */

import { translateElement } from '../translation.js';

let _menuEl = null;
let _actions = null;   // parallel array to .ctx-item NodeList — action per item

const _tpl = {
    get menu() { return document.getElementById('tpl-ctx-menu'); },
    get item() { return document.getElementById('tpl-ctx-item'); },
    get sep() { return document.getElementById('tpl-ctx-sep'); },
};


/**
 * Show the context menu at viewport coordinates (x, y).
 * @param {number}   x      clientX from the triggering event.
 * @param {number}   y      clientY from the triggering event.
 * @param {Array}    items  Array of item descriptors or the string 'separator'.
 */
export function showContextMenu(x, y, items) {
    closeContextMenu();
    _actions = [];

    const menu = _tpl.menu.content.cloneNode(true).querySelector('.ctx-menu');

    for (const item of items) {
        if (item === 'separator') {
            menu.appendChild(_tpl.sep.content.cloneNode(true).firstElementChild);
            continue;
        }
        const el = _tpl.item.content.cloneNode(true).querySelector('.ctx-item');
        el.querySelector('.ctx-label').dataset.i18n = item.labelKey;
        el.querySelector('.ctx-shortcut').textContent = item.shortcut ?? '';
        // data-idx maps the element back to _actions — set before translateElement
        // so the attribute is present when event delegation reads it.
        el.dataset.idx = _actions.length;
        translateElement(el);
        menu.appendChild(el);
        _actions.push(item.action);
    }

    // Delegated mousedown — activates the option under the pointer.
    menu.addEventListener('mousedown', _onMenuMousedown);
    // Delegated keydown — arrow navigation + Enter/Space/Escape.
    menu.addEventListener('keydown', _onMenuKeydown);

    // Position; clamp after insertion so we know the rendered dimensions.
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
    _menuEl = menu;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = Math.max(0, x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = Math.max(0, y - rect.height) + 'px';

    // Focus the first item.
    menu.querySelector('.ctx-item')?.focus();

    // Outside-mousedown dismissal (deferred so the triggering event doesn't close it).
    setTimeout(() => {
        document.addEventListener('mousedown', _onOutsideMousedown, { capture: true, once: true });
    }, 0);
}

/** Dismiss the context menu if one is open. */
export function closeContextMenu() {
    if (!_menuEl) return;
    _menuEl.remove();
    _menuEl = null;
    _actions = null;
    document.removeEventListener('mousedown', _onOutsideMousedown, { capture: true });
}


/* ===== Private ===== */

function _activateIdx(idx, shiftKey = false) {
    const action = _actions?.[idx];
    closeContextMenu();
    action?.(shiftKey);
}

function _onMenuMousedown(e) {
    const el = e.target.closest('.ctx-item[data-idx]');
    if (!el) return;
    e.preventDefault();
    _activateIdx(parseInt(el.dataset.idx, 10), e.shiftKey);
}

function _onMenuKeydown(e) {
    const items = [...(_menuEl?.querySelectorAll('.ctx-item') ?? [])];
    const current = items.indexOf(document.activeElement);

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            items[(current + 1) % items.length]?.focus();
            break;
        case 'ArrowUp':
            e.preventDefault();
            items[(current - 1 + items.length) % items.length]?.focus();
            break;
        case 'Enter':
        case ' ': {
            e.preventDefault();
            const idx = document.activeElement?.dataset.idx;
            if (idx !== undefined) _activateIdx(parseInt(idx, 10), e.shiftKey);
            break;
        }
        case 'Escape':
            e.preventDefault();
            closeContextMenu();
            break;
    }
}

function _onOutsideMousedown(e) {
    if (!_menuEl?.contains(e.target)) closeContextMenu();
}

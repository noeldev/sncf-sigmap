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
 * Build the menu DOM from an items array and attach delegated event listeners.
 * Separated from showContextMenu so DOM construction is independently readable.
 *
 * @param {Array} items  Item descriptors or the string 'separator'.
 * @returns {HTMLElement}
 */
function _buildMenu(items) {
    const menu = _tpl.menu.content.cloneNode(true).querySelector('.ctx-menu');
    _actions = [];

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

    return menu;
}

let _menuTimer = null;

/**
 * Show the context menu at viewport coordinates (x, y).
 * @param {number}   x      clientX from the triggering event.
 * @param {number}   y      clientY from the triggering event.
 * @param {Array}    items  Array of item descriptors or the string 'separator'.
 */
export function showContextMenu(x, y, items) {
    closeContextMenu();

    const menu = _buildMenu(items);

    // In fullscreen mode only the fullscreen element and its descendants are
    // rendered. Append inside that subtree so the menu is visible.
    const container = document.fullscreenElement ?? document.body;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    container.appendChild(menu);
    _menuEl = menu;

    // Clamp to viewport after insertion so rendered dimensions are known.
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)
        menu.style.left = Math.max(0, x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight)
        menu.style.top = Math.max(0, y - rect.height) + 'px';

    menu.querySelector('.ctx-item')?.focus();

    // Deferred so the triggering event does not immediately close the menu.
    _menuTimer = setTimeout(() => {
        document.addEventListener('mousedown', _onOutsideMousedown, { capture: true, once: true });
    }, 0);
}

/** Dismiss the context menu if one is open. */
export function closeContextMenu() {
    if (_menuTimer) {
        clearTimeout(_menuTimer);
        _menuTimer = null;
    }
    if (!_menuEl) return;
    _menuEl.remove();
    _menuEl = null;
    _actions = null;
    document.removeEventListener('mousedown', _onOutsideMousedown, { capture: true });
}


// ===== Private helpers =====

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

function _onOutsideMousedown(e) {
    if (!_menuEl?.contains(e.target)) closeContextMenu();
}

function _getItems() {
    return [...(_menuEl?.querySelectorAll('.ctx-item') ?? [])];
}

function _moveItemFocus(delta) {
    const items = _getItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const newIndex = (current + delta + items.length) % items.length;
    items[newIndex].focus();
}

const _nextItem = () => _moveItemFocus(1);
const _prevItem = () => _moveItemFocus(-1);

function _onMenuKeydown(e) {
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            _nextItem();
            break;
        case 'ArrowUp':
            e.preventDefault();
            _prevItem();
            break;
        case 'Tab':
            // Trap focus within the menu
            e.preventDefault();
            if (e.shiftKey) {
                _prevItem();
            } else {
                _nextItem();
            }
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

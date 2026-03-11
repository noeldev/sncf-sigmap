/**
 * ui/dropdown.js — Generic, accessible dropdown / listbox controller.
 *
 * Responsibilities:
 *   • Outside-click closing via a single shared capture-phase listener.
 *   • ARIA bootstrap: role="listbox", aria-expanded, aria-controls,
 *     aria-haspopup, aria-autocomplete on the appropriate element.
 *   • Keyboard navigation delegated on listEl (survives replaceChildren()):
 *       ArrowDown / ArrowUp   — navigate; ArrowUp on first → focusInput
 *       PageDown  / PageUp    — jump 8 items
 *       Enter     / Space     — activate item → onActivate callback
 *       Escape                — close, focusInput
 *       Tab / Shift+Tab       — Shift+Tab on first → focusInput; Tab on last → close
 *   • Focus helpers: focusItem(val), focusInput()
 *   • _programmaticFocus flag — prevents ComboBox.focus handler from
 *     reopening the dropdown after a programmatic focusInput() call.
 *
 * Does NOT handle:
 *   • Input search / typing (→ ComboBox)
 *   • Pill management        (→ PillList)
 *   • Application state      (→ caller)
 */

/* ===== Global shared registry ===== */

/** All live Dropdown instances, used by the shared outside-click listener. */
const _registry = [];

/**
 * Single capture-phase mousedown listener shared across all Dropdown instances.
 * Runs BEFORE any item mousedown handler, so the target is still in the DOM
 * even when the handler will call replaceChildren() later.
 *
 * Guard: check _dropdown + _trigger (the minimal interactive zone) rather than
 * _panel (the enclosing card), because _panel is typically the full-width filter
 * group — any sidebar click would satisfy panel.contains() and close() would
 * never fire.
 */
document.addEventListener('mousedown', e => {
    for (const dd of _registry) {
        if (dd._open &&
            !dd._dropdown.contains(e.target) &&
            !dd._trigger.contains(e.target)) {
            dd.close();
        }
    }
}, /* capture= */ true);

/* ===== Module-level helpers ===== */

/**
 * Close every currently-open Dropdown instance.
 * Use when switching tabs or opening a context menu that must not coexist
 * with an open dropdown.
 */
export function closeAll() {
    for (const dd of _registry) dd.close();
}

/* ===== Dropdown class ===== */

export class Dropdown {
    /**
     * @param {object}   opts
     * @param {Element}  opts.dropdownEl  — Container toggled via .is-hidden.
     * @param {Element}  opts.triggerEl   — Button or combo-input wrapper.
     *                                      Receives ARIA when no input is given.
     * @param {Element}  opts.listEl      — Listbox (direct parent of items).
     *                                      Gets role="listbox" and a stable id.
     * @param {Element} [opts.input]      — Optional <input>: combobox ARIA pattern.
     *                                      Absent: button ARIA pattern.
     * @param {string}  [opts.itemSel]    — CSS selector for items. Default '.dd-item'.
     * @param {Function} opts.onActivate  — (val, item) => void — keyboard activation.
     *                                      Mouse activation is wired by the caller.
     * @param {string}  [opts.activationFocusMode]
     *                                    — 'item' (default): focus stays on toggled item.
     *                                      'input': focus returns to search input.
     */
    constructor({ dropdownEl, triggerEl, listEl,
                  input = null, itemSel = '.dd-item', onActivate,
                  activationFocusMode = 'item' }) {
        this._dropdown          = dropdownEl;
        this._trigger           = triggerEl;
        this._list              = listEl;
        this._input             = input;
        this._itemSel           = itemSel;
        this._onActivate        = onActivate;
        this._activationFocusMode = activationFocusMode;
        this._open              = false;
        this._programmaticFocus = false;

        // ---- ARIA bootstrap ----
        if (!listEl.id) listEl.id = `dd-list-${Math.random().toString(36).slice(2, 9)}`;
        listEl.setAttribute('role', 'listbox');

        if (input) {
            input.setAttribute('role',            'combobox');
            input.setAttribute('aria-haspopup',   'listbox');
            input.setAttribute('aria-expanded',   'false');
            input.setAttribute('aria-controls',   listEl.id);
            input.setAttribute('aria-autocomplete', 'list');
            input.setAttribute('autocomplete',    'off');
        } else {
            triggerEl.setAttribute('aria-haspopup',  'listbox');
            triggerEl.setAttribute('aria-expanded',  'false');
            triggerEl.setAttribute('aria-controls',  listEl.id);
        }

        // ---- Keyboard handler — delegated on listEl ----
        // Delegation survives replaceChildren() on individual items.
        this._listKeyHandler = e => this._onListKey(e);
        listEl.addEventListener('keydown', this._listKeyHandler);

        _registry.push(this);
    }

    /* ----- Public API ----- */

    /** Show the dropdown. */
    open() {
        if (this._open) return;
        this._open = true;
        this._dropdown.classList.remove('is-hidden');
        this._setAriaExpanded(true);
    }

    /** Hide the dropdown. */
    close() {
        if (!this._open) return;
        this._open = false;
        this._dropdown.classList.add('is-hidden');
        this._setAriaExpanded(false);
    }

    /** Toggle open / close. */
    toggle() { this._open ? this.close() : this.open(); }

    /** Whether the dropdown is currently visible. */
    isOpen() { return this._open; }

    /** Focus the first item. */
    focusFirst() { this._items()[0]?.focus(); }

    /**
     * Focus the item whose data-val matches val.
     * Falls back to the first item when val is not found (e.g. after a rebuild).
     */
    focusItem(val) {
        if (val == null) { this.focusFirst(); return; }
        const sel = `${this._itemSel}[data-val="${CSS.escape(String(val))}"]`;
        (this._list.querySelector(sel) ?? this._items()[0])?.focus();
    }

    /**
     * Focus the search input with the caret at the end.
     * No-op for button-triggered dropdowns (no input element).
     *
     * Sets _programmaticFocus BEFORE .focus() because .focus() dispatches the
     * focus event synchronously.  queueMicrotask resets the flag after the
     * event has been processed, so subsequent user focus events work normally.
     */
    focusInput() {
        if (!this._input) return;
        this._programmaticFocus = true;
        this._input.focus();
        const len = this._input.value.length;
        this._input.setSelectionRange(len, len);
        queueMicrotask(() => { this._programmaticFocus = false; });
    }

    /**
     * Update aria-selected on all items.
     * @param {Set<string>} selectedVals
     */
    updateSelection(selectedVals) {
        for (const item of this._list.querySelectorAll(this._itemSel))
            item.setAttribute('aria-selected', String(selectedVals.has(item.dataset.val)));
    }

    /**
     * Unregister from the outside-click registry and detach the keydown handler.
     * Call when the panel is removed from the DOM.
     */
    destroy() {
        const i = _registry.indexOf(this);
        if (i >= 0) _registry.splice(i, 1);
        this._list.removeEventListener('keydown', this._listKeyHandler);
    }

    /* ----- Private ----- */

    _items() { return [...this._list.querySelectorAll(this._itemSel)]; }

    _setAriaExpanded(value) {
        (this._input ?? this._trigger)?.setAttribute('aria-expanded', String(value));
    }

    _onListKey(e) {
        const items = this._items();
        const ci    = items.indexOf(document.activeElement);

        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                this.close();
                this.focusInput();
                break;

            case 'ArrowDown':
                e.preventDefault();
                (items[ci + 1] ?? items[0])?.focus();   // wrap around
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (ci <= 0) this.focusInput();
                else items[ci - 1]?.focus();
                break;

            case 'PageDown':
                e.preventDefault();
                items[Math.min(ci + 8, items.length - 1)]?.focus();
                break;

            case 'PageUp':
                e.preventDefault();
                items[Math.max(ci - 8, 0)]?.focus();
                break;

            case 'Enter':
            case ' ': {
                e.preventDefault();
                if (!items[ci]) break;
                const val = items[ci].dataset.val;
                this._onActivate(val, items[ci]);
                // onActivate may call replaceChildren(), detaching the focused item
                // and moving browser focus to <body>.  queueMicrotask defers
                // refocus until after the browser processes that focus-to-body
                // event — a synchronous .focus() loses the race on Blink / WebKit.
                // 'input' mode: onActivate (_addExact) owns focus via its own
                // queueMicrotask; we must not enqueue here to avoid a double-focus.
                if (this._open && this._activationFocusMode === 'item')
                    queueMicrotask(() => this.focusItem(val));
                break;
            }

            case 'Tab':
                if (e.shiftKey && ci <= 0) {
                    e.preventDefault();
                    this.focusInput();
                } else if (!e.shiftKey && ci === items.length - 1) {
                    this.close();
                }
                break;
        }
    }
}

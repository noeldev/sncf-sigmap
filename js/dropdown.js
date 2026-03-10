/**
 * dropdown.js — Generic, accessible dropdown / combobox controller.
 *
 * Manages the logic that is identical between every dropdown in the app:
 *   • Outside-click closing (shared capture-phase listener via registry)
 *   • ARIA attributes (aria-expanded, role="listbox", role="option",
 *     aria-selected, aria-controls, aria-haspopup, autocomplete)
 *   • Keyboard navigation on the list:
 *       ArrowDown / ArrowUp   — move between items; ArrowUp on first → input
 *       PageDown  / PageUp    — jump 8 items
 *       Enter     / Space     — activate item (calls onActivate)
 *       Escape                — close, return focus to input
 *       Tab / Shift+Tab       — Shift+Tab on first → input; Tab on last → close
 *   • Focus management after list rebuilds:
 *       Enter/Space activation defers refocus via queueMicrotask so the
 *       browser finishes processing the focus-to-body event caused by
 *       replaceChildren() before we reassign focus.
 *       focusItem(val)  — focus item by data-val attribute
 *       focusInput()    — focus input, caret at end
 *
 * Callers retain full control over:
 *   • Item list DOM (build / rebuild via replaceChildren — Dropdown uses
 *     event delegation on listEl so it is unaffected by DOM rebuilds)
 *   • Open / close triggers (button click, input focus, combo arrow click…)
 *   • Activation logic (onActivate callback)
 *   • Closing other dropdowns when opening one (caller calls .open() after
 *     closing siblings)
 *
 * Usage — combobox, multi-select (filter panels, standard fields):
 *   const dd = new Dropdown({ panel, dropdownEl, triggerEl, listEl, input,
 *                              itemSel: '.fg-drop-item', onActivate });
 *
 * Usage — combobox, search-and-add (idreseau / minSearch fields):
 *   const dd = new Dropdown({ ..., activationFocusMode: 'input' });
 *   After keyboard activation, focus returns to the input instead of the item.
 *
 * Usage — button-triggered listbox (language picker):
 *   const dd = new Dropdown({ panel, dropdownEl, triggerEl, listEl,
 *                              itemSel: '.lang-option', onActivate });
 */

/* ===== Global shared registry ===== */

/** All live Dropdown instances, used by the shared outside-click listener. */
const _registry = [];

/**
 * Single capture-phase mousedown listener shared across all Dropdown instances.
 * Runs BEFORE any item's mousedown handler, so the target element is still
 * in the DOM even when the handler will later call replaceChildren().
 * panel.contains() is used (not a class selector) for structural robustness.
 */
document.addEventListener('mousedown', e => {
    for (const dd of _registry) {
        // Guard: is the click inside this dropdown's interactive area?
        // We check _dropdown (the listbox panel) and _trigger (the button /
        // combo wrapper) rather than _panel (the enclosing card), because
        // _panel is typically the full-width filter group — any click inside
        // the sidebar would satisfy panel.contains() and close() would never
        // fire.  _dropdown + _trigger is the minimal safe zone.
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
 * Use this when switching tabs or opening a context menu that should not
 * coexist with an open dropdown.
 */
export function closeAll() {
    for (const dd of _registry) dd.close();
}

/* ===== Dropdown class ===== */

export class Dropdown {
    /**
     * @param {object}   opts
     * @param {Element}  opts.panel       — Enclosing element.  Clicks inside
     *                                      this element never close the dropdown.
     * @param {Element}  opts.dropdownEl  — The container whose visibility is
     *                                      toggled via .is-hidden.
     * @param {Element}  opts.triggerEl   — The button or combo-input wrapper.
     *                                      Receives aria-expanded / aria-controls
     *                                      when no input is provided.
     * @param {Element}  opts.listEl      — The listbox (direct parent of items).
     *                                      Receives role="listbox" and a stable id.
     * @param {Element} [opts.input]      — Optional <input> inside the trigger.
     *                                      When present: combobox ARIA pattern.
     *                                      When absent:  button ARIA pattern.
     * @param {string}  [opts.itemSel]    — CSS selector for focusable items.
     *                                      Default: '.dd-item'.
     * @param {Function} opts.onActivate  — Called when an item is activated via
     *                                      keyboard Enter / Space.
     *                                      Signature: (val: string, item: Element) => void
     *                                      The same function should also be called
     *                                      by the caller's mousedown handler on items
     *                                      so that keyboard and mouse share one path.
     */
    constructor({ panel, dropdownEl, triggerEl, listEl,
        input = null, itemSel = '.dd-item', onActivate,
        activationFocusMode = 'item' }) {
        this._panel = panel;
        this._dropdown = dropdownEl;
        this._trigger = triggerEl;
        this._list = listEl;
        this._input = input;
        this._itemSel = itemSel;
        this._onActivate = onActivate;
        this._activationFocusMode = activationFocusMode;
        this._open = false;
        this._programmaticFocus = false;

        // ---- ARIA bootstrap ----
        // Give the listbox a stable id so aria-controls can reference it.
        if (!listEl.id) {
            listEl.id = `dd-list-${Math.random().toString(36).slice(2, 9)}`;
        }
        listEl.setAttribute('role', 'listbox');

        if (input) {
            // Combobox pattern: ARIA lives on the <input>.
            input.setAttribute('role', 'combobox');
            input.setAttribute('aria-haspopup', 'listbox');
            input.setAttribute('aria-expanded', 'false');
            input.setAttribute('aria-controls', listEl.id);
            input.setAttribute('aria-autocomplete', 'list');
            input.setAttribute('autocomplete', 'off');
        } else {
            // Button pattern: ARIA lives on the trigger button.
            triggerEl.setAttribute('aria-haspopup', 'listbox');
            triggerEl.setAttribute('aria-expanded', 'false');
            triggerEl.setAttribute('aria-controls', listEl.id);
        }

        // ---- Keyboard handler on list (event delegation) ----
        // Delegating to listEl means the handler survives replaceChildren() on
        // individual items — no re-wiring needed after list rebuilds.
        this._listKeyHandler = e => this._onListKey(e);
        listEl.addEventListener('keydown', this._listKeyHandler);

        // Register for outside-click detection.
        _registry.push(this);
    }

    // Public API 

    /** Show the dropdown and update ARIA. */
    open() {
        if (this._open) return;
        this._open = true;
        this._dropdown.classList.remove('is-hidden');
        this._setAriaExpanded(true);
    }

    /** Hide the dropdown and update ARIA. */
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

    /** Focus the first item in the list. */
    focusFirst() { this._items()[0]?.focus(); }

    /**
     * Focus the item whose data-val matches the given value.
     * Falls back to the first item when the value is not found (e.g. after a
     * list rebuild that removed the previously-focused item).
     * No-op when the list is empty.
     */
    focusItem(val) {
        if (val == null) { this.focusFirst(); return; }
        const escaped = CSS.escape(String(val));
        const sel = `${this._itemSel}[data-val="${escaped}"]`;
        (this._list.querySelector(sel) ?? this._items()[0])?.focus();
    }

    /**
     * Focus the search input and move the caret to the end of its value.
     * No-op when this Dropdown has no input (button-triggered pattern).
     */
    focusInput() {
        if (!this._input) return;
        // Set the flag BEFORE calling .focus() — .focus() dispatches the focus
        // event synchronously, so the flag must be true when the event handler
        // runs.  queueMicrotask resets it after the event has been processed,
        // so subsequent user-initiated focus events are handled normally.
        this._programmaticFocus = true;
        this._input.focus();
        const len = this._input.value.length;
        this._input.setSelectionRange(len, len);
        queueMicrotask(() => { this._programmaticFocus = false; });
    }

    /**
     * Update aria-selected on all items in the list.
     * Call this after rebuilding the item list to keep ARIA state current.
     *
     * @param {Set<string>} selectedVals — Set of currently-selected data-val strings.
     */
    updateSelection(selectedVals) {
        for (const item of this._list.querySelectorAll(this._itemSel)) {
            item.setAttribute('aria-selected', String(selectedVals.has(item.dataset.val)));
        }
    }

    /**
     * Remove this instance from the global outside-click registry and
     * detach the list keydown handler.  Call when the panel is removed from DOM.
     */
    destroy() {
        const i = _registry.indexOf(this);
        if (i >= 0) _registry.splice(i, 1);
        this._list.removeEventListener('keydown', this._listKeyHandler);
    }

    // Private 

    _items() {
        return [...this._list.querySelectorAll(this._itemSel)];
    }

    _setAriaExpanded(value) {
        // For combobox pattern the attribute lives on the input; for button
        // pattern it lives on the trigger.
        (this._input ?? this._trigger)?.setAttribute('aria-expanded', String(value));
    }

    _onListKey(e) {
        const items = this._items();
        const ci = items.indexOf(document.activeElement);

        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                this.close();
                this.focusInput();   // no-op for button-triggered dropdowns
                break;

            case 'ArrowDown':
                e.preventDefault();
                // Wrap around: Down on last item → first item.
                (items[ci + 1] ?? items[0])?.focus();
                break;

            case 'ArrowUp':
                e.preventDefault();
                // Up on first item → return to input (or no-op for button dropdowns).
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
                // The activation callback may call replaceChildren(), detaching the
                // focused item and moving browser focus to <body>.  queueMicrotask
                // defers the refocus until after the browser has processed that
                // focus change — a synchronous .focus() call at this point loses
                // the race on several engines (Blink, WebKit).
                // activationFocusMode controls where focus lands after activation:
                //  'item'  — stay on the toggled item (multi-select lists)
                //  'input' — return to the search input (idreseau / search-and-add)
                // For 'input' mode the onActivate callback (_addExact) owns
                // the focus-after-activation logic via its own queueMicrotask.
                // For 'item' mode we enqueue focusItem here so the rebuilt item
                // receives focus after replaceChildren() detached the old one.
                if (this._open && this._activationFocusMode === 'item') {
                    queueMicrotask(() => this.focusItem(val));
                }
                break;
            }

            case 'Tab':
                if (e.shiftKey && ci <= 0) {
                    // Shift+Tab on first item → return to input.
                    e.preventDefault();
                    this.focusInput();
                } else if (!e.shiftKey && ci === items.length - 1) {
                    // Tab on last item → close and let focus move naturally.
                    this.close();
                }
                break;
        }
    }
}

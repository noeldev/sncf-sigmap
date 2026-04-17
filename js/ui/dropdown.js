/**
 * ui/dropdown.js — Generic, accessible dropdown / listbox controller.
 *
 * Responsibilities:
 *   - Outside-click closing via a single shared capture-phase listener.
 *   - "is-open" CSS class on triggerEl — used by CSS to animate chevrons.
 *   - aria-controls wiring and aria-expanded state management.
 *   - Keyboard navigation delegated on listEl (survives replaceChildren()):
 *       ArrowDown / ArrowUp   — navigate items (wraps around)
 *       PageDown  / PageUp    — jump 8 items
 *       Enter     / Space     — activate → onActivate callback
 *       Escape                — close, focusInput
 *       Tab                   — close
 *   - Focus helpers: focusFirst(), focusItem(val), focusInput()
 *   - programmaticFocus getter — lets ComboBox skip re-opening the dropdown
 *     when focus is restored programmatically (after Escape, tag removal…).
 *
 * Static ARIA (role, aria-haspopup, aria-autocomplete) is set in HTML and
 * intentionally not duplicated here. Only aria-controls (references a
 * generated id) and aria-expanded (dynamic state) are set by JS.
 *
 * Architecture note — # private fields vs. the shared registry:
 *   The module-level registry listener must inspect instances from outside the
 *   class and can only call public methods. All private state is therefore
 *   exposed only through containsTarget() and isOpen(). Every other field
 *   remains private.
 *
 * Does NOT handle:
 *   - Input search / typing  (→ ComboBox)
 *   - Tag management        (→ TagList)
 *   - Application state      (→ caller)
 */


// ===== Global shared outside-click registry =====

/** All live Dropdown instances — used by the shared outside-click listener. */
const _registry = [];

/**
 * Single capture-phase mousedown listener shared across all instances.
 * Runs BEFORE any item mousedown handler so the target is still in the DOM
 * even if the handler calls replaceChildren() later.
 *
 * Only public API is used here (isOpen, containsTarget) so that # private
 * fields remain inaccessible from module scope.
 */
document.addEventListener('mousedown', e => {
    for (const dd of _registry) {
        if (dd.isOpen() && !dd.containsTarget(e.target)) dd.close();
    }
}, /* capture= */ true);


// ===== Module-level exports =====

/** Close every currently-open Dropdown (tab switches, context-menu opens…). */
export function closeAll() {
    for (const dd of _registry) dd.close();
}


// ===== Dropdown class =====

export class Dropdown {
    // ----- Private fields -----
    #dropdown;
    #trigger;
    #list;
    #input;
    #itemSel;
    #onActivate;
    #activationFocusMode;
    #isOpen = false;
    #programmaticFocus = false;
    #listKeyHandler;

    /**
     * @param {object}   opts
     * @param {Element}  opts.dropdownEl        — Container toggled via .is-hidden.
     * @param {Element}  opts.triggerEl         — Receives .is-open on open() for CSS animation.
     * @param {Element}  opts.listEl            — Listbox (direct parent of items).
     * @param {Element}  [opts.input]           — <input> for combobox, or the trigger
     *                                            button itself (lang-picker) for focusInput().
     * @param {string}   [opts.itemSel]         — CSS selector for items. Default '.dd-item'.
     * @param {Function} opts.onActivate        — (val, item) → void
     * @param {string}   [opts.activationFocusMode]  'item' | 'input'  (default 'item')
     */
    constructor({ dropdownEl, triggerEl, listEl,
        input = null, itemSel = '.dd-item', onActivate,
        activationFocusMode = 'item' }) {
        this.#dropdown = dropdownEl;
        this.#trigger = triggerEl;
        this.#list = listEl;
        this.#input = input;
        this.#itemSel = itemSel;
        this.#onActivate = onActivate;
        this.#activationFocusMode = activationFocusMode;

        this.#bootstrapAria();
        this.#listKeyHandler = e => this.#onListKey(e);
        listEl.addEventListener('keydown', this.#listKeyHandler);
        _registry.push(this);
    }


    // ===== Public API =====

    open() {
        if (this.#isOpen) return;
        this.#isOpen = true;
        this.#dropdown.classList.remove('is-hidden');
        this.#trigger.classList.add('is-open');
        this.#setAriaExpanded(true);
    }

    close() {
        if (!this.#isOpen) return;
        this.#isOpen = false;
        this.#dropdown.classList.add('is-hidden');
        this.#trigger.classList.remove('is-open');
        this.#setAriaExpanded(false);
    }

    toggle() { this.#isOpen ? this.close() : this.open(); }

    isOpen() { return this.#isOpen; }

    /**
     * True when the given target is inside the dropdown or the trigger.
     * Used by the shared outside-click registry — the only place that needs
     * to inspect instance geometry from module scope.
     * @param {EventTarget} target
     * @returns {boolean}
     */
    containsTarget(target) {
        return this.#dropdown.contains(target) || this.#trigger.contains(target);
    }

    focusFirst() { this.#items()[0]?.focus(); }

    /**
     * Focus the item whose data-val matches val.
     * Falls back to the first item when val is not found (e.g. after a rebuild).
     * @param {string|null} val
     */
    focusItem(val) {
        if (val == null) { this.focusFirst(); return; }
        const sel = `${this.#itemSel}[data-val="${CSS.escape(String(val))}"]`;
        (this.#list.querySelector(sel) ?? this.#items()[0])?.focus();
    }

    /**
     * Focus the input (or trigger button for lang-picker) with caret at end.
     * Sets #programmaticFocus BEFORE .focus() so ComboBox's focus handler
     * skips re-opening the dropdown when focus returns programmatically.
     * setSelectionRange is only called on elements that support it (<input>).
     */
    focusInput() {
        if (!this.#input) return;
        this.#programmaticFocus = true;
        this.#input.focus();
        if (typeof this.#input.setSelectionRange === 'function') {
            const len = this.#input.value?.length ?? 0;
            this.#input.setSelectionRange(len, len);
        }
        queueMicrotask(() => { this.#programmaticFocus = false; });
    }

    /**
     * Read by ComboBox to skip re-opening on programmatic focus.
     */
    get programmaticFocus() { return this.#programmaticFocus; }

    /**
     * Unregister from the outside-click registry and remove the keydown handler.
     * Must be called before removing the panel from the DOM.
     */
    destroy() {
        const i = _registry.indexOf(this);
        if (i >= 0) _registry.splice(i, 1);
        this.#list.removeEventListener('keydown', this.#listKeyHandler);
    }


    // ===== Private helpers =====

    #items() { return [...this.#list.querySelectorAll(this.#itemSel)]; }

    #setAriaExpanded(value) {
        (this.#input ?? this.#trigger)?.setAttribute('aria-expanded', String(value));
    }

    /**
     * Set only the attributes that cannot be expressed as static HTML:
     *   - list id (generated, needed for aria-controls reference)
     *   - aria-controls (references the generated id)
     *   - aria-expanded initial state (for <input> elements that don't have it in HTML;
     *     buttons already carry aria-expanded="false" in the HTML template)
     *
     * Static attributes (role, aria-haspopup, aria-autocomplete) are in the HTML
     * template and are not duplicated here.
     */
    #bootstrapAria() {
        if (!this.#list.id) {
            this.#list.id = `dd-list-${Math.random().toString(36).slice(2, 9)}`;
        }
        const controlTarget = this.#input ?? this.#trigger;
        controlTarget.setAttribute('aria-controls', this.#list.id);

        // Set aria-expanded only when not already present in HTML.
        // Buttons (lang-picker) carry it statically; <input> elements do not.
        if (!controlTarget.hasAttribute('aria-expanded')) {
            controlTarget.setAttribute('aria-expanded', 'false');
        }
    }

    /** Dispatch keydown events on the list to focused sub-handlers. */
    #onListKey(e) {
        const items = this.#items();
        const ci = items.indexOf(document.activeElement);
        if (this.#handleEscape(e)) return;
        if (this.#handleNavigation(e, items, ci)) return;
        if (e.key === 'Tab') { this.close(); return; }
        this.#handleActivation(e, items, ci);
    }

    /** Escape: close the dropdown and return focus to the input. */
    #handleEscape(e) {
        if (e.key !== 'Escape') return false;
        e.preventDefault();
        this.close();
        this.focusInput();
        return true;
    }

    /** ArrowDown / ArrowUp / PageDown / PageUp: navigate the item list. */
    #handleNavigation(e, items, ci) {
        const last = items.length - 1;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                (items[ci + 1] ?? items[0])?.focus();
                return true;
            case 'ArrowUp':
                e.preventDefault();
                (items[ci - 1] ?? items[last])?.focus();
                return true;
            case 'PageDown':
                e.preventDefault();
                items[Math.min(ci + 8, last)]?.focus();
                return true;
            case 'PageUp':
                e.preventDefault();
                items[Math.max(ci - 8, 0)]?.focus();
                return true;
            default:
                return false;
        }
    }

    /**
     * Enter / Space: activate the focused item.
     * onActivate may call replaceChildren(), moving focus to <body>.
     * queueMicrotask defers refocus until the browser processes that event.
     * 'input' mode: onActivate owns its own refocus — do not double-enqueue.
     */
    #handleActivation(e, items, ci) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const item = items[ci];
        if (!item) return;
        const val = item.dataset.val;
        this.#onActivate(val, item);
        if (this.#isOpen && this.#activationFocusMode === 'item') {
            queueMicrotask(() => this.focusItem(val));
        }
    }
}

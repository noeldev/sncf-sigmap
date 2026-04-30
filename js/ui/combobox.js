/**
 * ui/combobox.js — Editbox interactions for a combo filter.
 *
 * Responsibilities:
 *   • Input search with debounce → onSearch callback
 *   • Keyboard navigation: ArrowDown, Enter, Escape, Tab, Space (readonly)
 *   • Numeric-only guard for digit-restricted fields
 *   • Clear button: resets input and fires onSearch('') immediately
 *   • Arrow button: toggles the dropdown open/closed
 *   • Focus guard: skips programmatic focusInput() calls
 *
 * Each concern is isolated in a module-level private function so the
 * constructor only orchestrates; no logic lives inside it.
 *
 * Does NOT handle:
 *   - Dropdown list rendering or keyboard navigation inside the list (→ Dropdown)
 *   - Tag management (→ TagList)
 *   - Application state (→ caller)
 */

/** Debounce delay in ms for the search input. */
const SEARCH_DEBOUNCE_MS = 200;

/** Pre-compiled regex — avoids recompiling on every keystroke. */
const RE_DIGIT = /[0-9]/;
const RE_NOTDIGIT = /\D/g;

/**
 * Return true when the current value has already committed to "numeric code"
 * intent — i.e. its first non-space character is a digit.
 *
 *   ""         → false (no intent yet; any character is welcome)
 *   "3", "3a"  → true  (digit first; only digits allowed from here on)
 *   "a", "a3"  → false (letter first; text intent locked in)
 *
 * Used by the character-input filter: once a digit opens the input, the
 * combo behaves like a numeric-only field until the user clears it. If no
 * characters have been typed yet, no filter applies.
 */
function _isNumericIntent(value) {
    const first = value.trimStart()[0];
    return !!first && RE_DIGIT.test(first);
}

// ===== ComboBox class =====

export class ComboBox {
    /**
     * @param {object}        opts
     * @param {HTMLInputElement}    opts.inputEl
     * @param {HTMLElement}         opts.comboWrapEl       — Wrapper (.fg-combo-input).
     * @param {HTMLButtonElement}   [opts.clearButtonEl]   — The "×" clear button.
     * @param {HTMLButtonElement}   [opts.arrowButtonEl]   — The chevron toggle button.
     * @param {Dropdown}            opts.dropdown
     * @param {Function}            [opts.onSearch]        — Called with transformed query.
     * @param {Function}            [opts.onEnter]         — Called on Enter key.
     * @param {Function}            [opts.onOpen]          — Override for opening the dropdown.
     * @param {boolean}             [opts.numericOnly]     — Allow only digit input.
     * @param {Function}            [opts.searchTransform] — Maps raw value → query.
     *                                                       Default: toUpperCase().
     *                                                       Pass `v => v` for labelSearch.
     */
    constructor({
        inputEl, comboWrapEl, clearButtonEl, arrowButtonEl, dropdown,
        onSearch, onEnter, onOpen, numericOnly = false, searchTransform,
    }) {
        const _open = onOpen ?? (() => dropdown.open());
        const _transform = searchTransform ?? (v => v.toUpperCase());

        // syncClearBtn: shared between #initClearButton and #initSearch.
        // Returned from #initClearButton so FilterPanel is not involved.
        let syncClearBtn = null;

        if (clearButtonEl && !inputEl.readOnly) {
            syncClearBtn = this.#initClearButton(inputEl, clearButtonEl, onSearch, dropdown, _open);
        }

        this.#initKeyboard(inputEl, numericOnly, onEnter, dropdown, _open);

        if (!inputEl.readOnly) {
            this.#initSearch(inputEl, numericOnly, _transform, onSearch, syncClearBtn);
        }

        this.#initFocus(inputEl, dropdown, _open);

        if (arrowButtonEl) {
            this.#initArrowButton(arrowButtonEl, dropdown, _open);
        }

        this.#initWrapperClick(comboWrapEl, arrowButtonEl, dropdown, _open);
    }

    /**
     * Wire the clear (×) button inside the combo input.
     * Hides/shows based on whether the input has content.
     * 
     * Two listeners with distinct responsibilities:
     *   mousedown — preventDefault to keep focus on the input (mouse only).
     *   click     — clear action, fires for both mouse and keyboard
     *               (Enter/Space on a focused button natively emits 'click').
     *
     * @param {HTMLInputElement} inputEl
     * @param {HTMLButtonElement} clearButtonEl
     * @param {Function} onSearch
     * @param {Dropdown} dropdown
     * @param {Function} _open
     * @returns {Function} syncFn — call after any programmatic value change.
     */
    #initClearButton(inputEl, clearButtonEl, onSearch, dropdown, _open) {
        const sync = () =>
            clearButtonEl.classList.toggle('is-hidden', inputEl.value.length === 0);
        sync();

        // Prevent focus theft on mouse click — the input must keep focus.
        clearButtonEl.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
        });

        // Single action handler for both mouse and keyboard (Enter/Space
        // on a focused <button> natively fires 'click').
        clearButtonEl.addEventListener('click', () => {
            if (inputEl.value === '') return;
            inputEl.value = '';
            sync();
            onSearch?.('');
            dropdown.focusInput();
            _open();
        });

        return sync;
    }

    /**
     * Wire keyboard navigation keys on the <input>.
     * Handles: ArrowDown, Enter, Space, Escape, Tab.
     *
     * Character-input filter — applied to any printable keystroke:
     *
     *   1. numericOnly=true (e.g. networkId):
     *        only digits are ever accepted.
     *
     *   2. writable, empty input:
     *        anything goes — the first character decides the intent.
     *
     *   3. writable, first non-space character is a digit (e.g. "395"):
     *        numeric intent is locked in. Only digits are accepted from here on.
     *        Typing a letter or space is rejected. The user must clear the
     *        input first to switch to text intent.
     *
     *   4. writable, first non-space character is a letter (e.g. "Paris"):
     *        text intent — all characters including digits and spaces pass.
     *
     * Space, when allowed in text-intent inputs, also calls stopPropagation()
     * so ancestor ARIA buttons (cp-panel summaries) do not treat the keystroke
     * as a panel toggle.
     *
     * Readonly combos (direction, placement) ignore the filter entirely
     * and treat Space + Enter as the "activate" action.
     *
     * @param {HTMLInputElement} inputEl
     * @param {boolean} numericOnly
     * @param {Function|undefined} onEnter
     * @param {Dropdown} dropdown
     * @param {Function} _open
     */
    #initKeyboard(inputEl, numericOnly, onEnter, dropdown, _open) {
        inputEl.addEventListener('keydown', e => {
            // Character-input filter — only applies to printable keys on writable
            // inputs. Navigation keys (arrows, Home, End…) have e.key.length > 1
            // and are always allowed through to the input's native handling.
            if (!inputEl.readOnly
                && e.key.length === 1
                && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const digitsOnly = numericOnly || _isNumericIntent(inputEl.value);
                if (digitsOnly) {
                    if (!RE_DIGIT.test(e.key)) {
                        e.preventDefault();
                        // Also stop bubbling — otherwise Space in numeric-intent
                        // mode would still reach the ancestor cp-panel summary
                        // and toggle the panel.
                        e.stopPropagation();
                        return;
                    }
                } else if (e.key === ' ') {
                    // Text intent, space passes — block bubbling to ancestor toggles.
                    e.stopPropagation();
                }
            }

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    _open();
                    dropdown.focusFirst();
                    break;
                case ' ':
                    // Readonly combos only: Space behaves like Enter.
                    // Writable inputs have already been handled by the filter above.
                    if (inputEl.readOnly) {
                        e.preventDefault();
                        onEnter?.();
                    }
                    break;
                case 'Enter':
                    e.preventDefault();
                    onEnter?.();
                    break;
                case 'Escape':
                    e.preventDefault();
                    dropdown.close();
                    break;
                case 'Tab':
                    dropdown.close();
                    break;
            }
        });
    }

    /**
     * Wire the debounced live-search input handler.
     * Also runs the clear-button sync callback on every keystroke.
     *
     * Safety net for paste / autofill / IME: bypasses the keydown filter and
     * sanitises the committed value to match the character-input rules:
     *   - numericOnly        → strip everything that isn't a digit
     *   - writable, numeric  → (first char is a digit) strip all non-digits
     *   - writable, text     → (first char is a letter) accept as-is
     *
     * @param {HTMLInputElement} inputEl
     * @param {boolean} numericOnly
     * @param {Function} transform   Maps raw value → query string passed to onSearch.
     * @param {Function|undefined} onSearch
     * @param {Function|null} syncClearBtn
     */
    #initSearch(inputEl, numericOnly, transform, onSearch, syncClearBtn) {
        let _timer = null;
        inputEl.addEventListener('input', () => {
            // After paste / IME, strip characters that violate the current intent.
            // _isNumericIntent uses trimStart()[0] — so a pasted value like "abc"
            // into an empty input locks in text intent naturally.
            if (numericOnly || _isNumericIntent(inputEl.value)) {
                const digitsOnly = inputEl.value.replace(RE_NOTDIGIT, '');
                if (inputEl.value !== digitsOnly) inputEl.value = digitsOnly;
            }
            syncClearBtn?.();
            clearTimeout(_timer);
            _timer = setTimeout(() => onSearch?.(transform(inputEl.value)), SEARCH_DEBOUNCE_MS);
        });
    }

    /**
     * Open the dropdown when the user focuses the input.
     * Skips programmatic focus calls flagged by Dropdown._programmaticFocus.
     *
     * @param {HTMLInputElement} inputEl
     * @param {Dropdown} dropdown
     * @param {Function} _open
     */
    #initFocus(inputEl, dropdown, _open) {
        inputEl.addEventListener('focus', () => {
            if (dropdown.programmaticFocus) return;
            _open();
        });
    }

    /**
     * Wire the arrow (chevron) button.
     * mousedown prevents focus theft on mouse click;
     * click handles both mouse and keyboard (Enter/Space on focused button).
     *
     * @param {HTMLButtonElement} arrowButtonEl
     * @param {Dropdown} dropdown
     * @param {Function} _open
     */
    #initArrowButton(arrowButtonEl, dropdown, _open) {
        // Prevent the button from stealing focus from the input on mouse click.
        arrowButtonEl.addEventListener('mousedown', e => e.preventDefault());
        arrowButtonEl.addEventListener('click', () => {
            if (dropdown.isOpen()) {
                dropdown.close();
            } else {
                _open();
                dropdown.focusInput();
            }
        });
    }

    /**
     * Handle clicks on the bare wrapper area (between input and buttons).
     * With both interactive elements being buttons this is rarely reached,
     * but is kept as a reliable fallback for clicks on the wrapper padding.
     *
     * @param {HTMLElement} comboWrapEl
     * @param {HTMLButtonElement|undefined} arrowButtonEl
     * @param {Dropdown} dropdown
     * @param {Function} _open
     */
    #initWrapperClick(comboWrapEl, arrowButtonEl, dropdown, _open) {
        comboWrapEl.addEventListener('mousedown', e => {
            // Interactive children handle themselves — only act on bare wrapper clicks.
            if (e.target.closest('input, button')) return;
            e.preventDefault();
            if (dropdown.isOpen()) {
                dropdown.close();
            } else {
                _open();
                dropdown.focusInput();
            }
        });
    }
}

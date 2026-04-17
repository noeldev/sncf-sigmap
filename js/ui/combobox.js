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
const RE_NUMERIC = /^\d*$/;

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
     * On click: empties input, fires onSearch immediately, reopens dropdown.
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

        const handler = (e) => {
            if (e.type === 'mousedown') {
                e.preventDefault();
                e.stopPropagation();
            }
            if (inputEl.value === '') return;
            inputEl.value = '';
            sync();
            onSearch?.('');
            dropdown.focusInput();
            _open();
        };

        clearButtonEl.addEventListener('mousedown', handler);
        clearButtonEl.addEventListener('click', handler);   // ← ajout pour le clavier

        return sync;
    }

    /**
     * Wire keyboard navigation keys on the <input>.
     * Handles: ArrowDown, Enter, Space (readonly), Escape, Tab.
     * Numeric-only guard blocks non-digit printable characters.
     *
     * @param {HTMLInputElement} inputEl
     * @param {boolean} numericOnly
     * @param {Function|undefined} onEnter
     * @param {Dropdown} dropdown
     * @param {Function} _open
     */
    #initKeyboard(inputEl, numericOnly, onEnter, dropdown, _open) {
        inputEl.addEventListener('keydown', e => {
            if (numericOnly && e.key.length === 1 && !RE_DIGIT.test(e.key)
                && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                return;
            }
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    _open();
                    dropdown.focusFirst();
                    break;
                case 'Enter':
                    e.preventDefault();
                    onEnter?.();
                    break;
                case ' ':
                    // Readonly (direction, placement): Space toggles, like Enter.
                    // Writable: Space must type normally for multi-word searches.
                    if (inputEl.readOnly) { e.preventDefault(); onEnter?.(); }
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
     * @param {HTMLInputElement} inputEl
     * @param {boolean} numericOnly
     * @param {Function} transform   Maps raw value → query string passed to onSearch.
     * @param {Function|undefined} onSearch
     * @param {Function|null} syncClearBtn
     */
    #initSearch(inputEl, numericOnly, transform, onSearch, syncClearBtn) {
        let _timer = null;
        inputEl.addEventListener('input', () => {
            // Safety net for paste / autofill / IME on numericOnly fields.
            if (numericOnly && !RE_NUMERIC.test(inputEl.value)) inputEl.value = '';
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

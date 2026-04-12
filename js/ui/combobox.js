/**
 * ui/combobox.js — Editbox interactions for a combo filter.
 *
 * Wires four event listeners that would otherwise be attached individually
 * for every combo filter:
 *   • <input> "input"            — live search → onSearch callback (debounced SEARCH_DEBOUNCE_MS)
 *   • <input> "keydown"          — ArrowDown / Enter / Escape / Tab
 *   • <input> "focus"            — open dropdown on user focus
 *   • comboWrapEl "mousedown"    — arrow-button toggles open/close
 *
 * Keyboard navigation inside the list is delegated to the Dropdown instance.
 * ComboBox only handles keys fired while the <input> itself is focused.
 *
 * The _programmaticFocus flag (owned by Dropdown) prevents the focus handler
 * from reopening the dropdown when focus is restored programmatically after
 * Escape, ArrowUp, pill removal, or _selectFirst.
 */
/** Debounce delay in ms for the search input — avoids scanning large indexes on every keystroke. */
const SEARCH_DEBOUNCE_MS = 200;


export class ComboBox {
    /**
     * @param {object}   opts
     * @param {Element}  opts.inputEl     — The <input> element.
     * @param {Element}  opts.comboWrapEl — Wrapper holding input + arrow button.
     *                                      Receives the arrow-click mousedown handler.
     * @param {Dropdown} opts.dropdown    — The Dropdown controller for this combo.
     * @param {Function} [opts.onSearch]  — Called with the uppercased query string
     *                                      on every input event.
     * @param {Function} [opts.onEnter]   — Called when Enter is pressed in the input.
     * @param {Function} [opts.onOpen]    — Called to open the dropdown.
     * @param {boolean} [opts.numericOnly] — When true, only digit input is accepted.
     *                                       Sets a keydown guard and a paste/IME safety net.
     */
    constructor({ inputEl, comboWrapEl, dropdown, onSearch, onEnter, onOpen, numericOnly }) {
        // Normalise onOpen so the rest of the code never needs to branch.
        const _open = onOpen ?? (() => dropdown.open());

        // Single keydown handler: numeric guard (numericOnly) + navigation keys.
        inputEl.addEventListener('keydown', e => {
            // Block non-digit printable characters for numericOnly fields.
            // Allow Ctrl/Cmd shortcuts (copy, paste, select-all, etc.).
            if (numericOnly && e.key.length === 1 && !/[0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
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
                    // For readonly fields (direction, placement) Space opens the dropdown.
                    // For writable inputs, Space must type normally so text searches with
                    // spaces (e.g. track names) work correctly.
                    if (inputEl.readOnly) {
                        e.preventDefault();
                        onEnter?.();
                    }
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

        if (!inputEl.readOnly) {
            let _searchTimer = null;
            inputEl.addEventListener('input', () => {
                // Safety net for paste/autofill/IME: if the value contains
                // any non-digit character, clear it entirely.
                if (numericOnly && !/^\d*$/.test(inputEl.value)) {
                    inputEl.value = '';
                }
                clearTimeout(_searchTimer);
                _searchTimer = setTimeout(
                    () => onSearch?.(inputEl.value.toUpperCase()),
                    SEARCH_DEBOUNCE_MS
                );
            });
        }

        inputEl.addEventListener('focus', () => {
            // Guard: skip programmatic focus calls (after Escape, ArrowUp, pill
            // removal, _selectFirst…).  Without this every focusInput() call
            // would immediately reopen the dropdown it just closed.
            // The flag is set in Dropdown.focusInput() and reset via queueMicrotask.
            if (dropdown._programmaticFocus) return;
            _open();
        });

        // Arrow-button click: toggle open/close and return focus to the input.
        // The e.target guard lets the input element handle its own mouse events
        // without this handler interfering.
        comboWrapEl.addEventListener('mousedown', e => {
            if (e.target === inputEl) return;
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

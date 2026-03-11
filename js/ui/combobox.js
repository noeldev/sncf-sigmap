/**
 * ui/combobox.js — Editbox interactions for a combo filter.
 *
 * Wires four event listeners that would otherwise be attached individually
 * for every combo filter:
 *   • <input> "input"            — live search → onSearch callback
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
     * @param {Function} [opts.onOpen]    — Called to open the dropdown.  Use this to
     *                                      close sibling dropdowns first.
     *                                      Falls back to dropdown.open() if absent.
     */
    constructor({ inputEl, comboWrapEl, dropdown, onSearch, onEnter, onOpen }) {
        // Normalise onOpen so the rest of the code never needs to branch.
        const _open = onOpen ?? (() => dropdown.open());

        inputEl.addEventListener('input', () =>
            onSearch?.(inputEl.value.toUpperCase()));

        inputEl.addEventListener('keydown', e => {
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
                case 'Escape':
                    e.preventDefault();
                    dropdown.close();
                    break;
                case 'Tab':
                    dropdown.close();
                    break;
            }
        });

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

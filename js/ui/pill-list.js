/**
 * ui/pill-list.js — Removable value pill (tag) list.
 *
 * Uses event delegation on the container so render() rebuilds DOM without
 * attaching any per-pill listeners. The delegated handlers are attached once
 * at construction and survive all subsequent replaceChildren() calls.
 *
 * Expected pill template structure (tpl-filter-tag):
 *   .fg-tag[data-val]  > .fg-tag-label
 *                        .fg-tag-remove (button)
 *
 * Keyboard contract:
 *   .fg-tag-remove  — Space/Enter → onRemove; Shift+Space/Shift+Enter → remove all others
 *   .fg-tag-label   — Space/Enter → onLabelClick (when onLabelClick is set)
 *
 * Shift+remove semantics: every other pill's onRemove is called; the clicked
 * pill's remove button receives focus after the parent re-renders.
 */
export class PillList {
    /**
     * @param {object}   opts
     * @param {Element}  opts.containerEl    Element that holds all pill nodes.
     * @param {Element}  opts.template       <template> for one pill (.fg-tag).
     * @param {Function} opts.onRemove       Called with value when a pill is removed.
     * @param {Function} [opts.onLabelClick] Called with value when the label is activated.
     *                                       When provided, labels become focusable buttons.
     */
    constructor({ containerEl, template, onRemove, onLabelClick }) {
        this._el = containerEl;
        this._tpl = template;
        this._onRemove = onRemove;
        this._onLabelClick = onLabelClick ?? null;

        // Single delegated mousedown handles both remove and label interactions.
        // mousedown instead of click so e.preventDefault() keeps focus on the button.
        containerEl.addEventListener('mousedown', e => this._handleMouse(e));

        // Single delegated keydown handles keyboard activation of both targets.
        containerEl.addEventListener('keydown', e => this._handleKey(e));
    }

    /**
     * Rebuild the pill list from an array of values.
     * @param {string[]}            values
     * @param {function(string): string} [labelFn]  Maps value → display text.
     */
    render(values, labelFn = v => v) {
        this._el.replaceChildren();
        for (const v of values) {
            const tag = this._tpl.content.cloneNode(true).querySelector('.fg-tag');
            tag.dataset.val = v;
            tag.querySelector('.fg-tag-label').textContent = labelFn(v);

            if (this._onLabelClick) {
                tag.classList.add('fg-tag--clickable');
                const label = tag.querySelector('.fg-tag-label');
                label.setAttribute('tabindex', '0');
                label.setAttribute('role', 'button');
            }

            this._el.appendChild(tag);
        }
    }

    show() { this._el.classList.remove('is-hidden'); }
    hide() { this._el.classList.add('is-hidden'); }


    // ===== Private helpers =====

    _handleMouse(e) {
        this._processTarget(e.target, e.shiftKey, () => e.preventDefault());
    }

    _handleKey(e) {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        this._processTarget(e.target, e.shiftKey, () => e.preventDefault());
    }

    /**
     * Process a target element (remove button or clickable label) and trigger
     * the corresponding callback.
     * @param {Element} target      The raw event target.
     * @param {boolean} shiftKey    Whether Shift is pressed.
     * @param {Function} preventDefault  Callback to prevent default browser behavior.
     */
    _processTarget(target, shiftKey, preventDefault) {
        // Remove button.
        const removeBtn = target.closest('.fg-tag-remove');
        if (removeBtn) {
            preventDefault();
            const val = removeBtn.closest('.fg-tag')?.dataset.val ?? null;
            if (val === null) return;
            if (shiftKey) this._removeAllExcept(val);
            else this._onRemove(val);
            return;
        }

        // Clickable label.
        if (this._onLabelClick) {
            const label = target.closest('.fg-tag-label');
            if (label?.closest('.fg-tag--clickable')) {
                preventDefault();
                const val = label.closest('.fg-tag')?.dataset.val ?? null;
                if (val !== null) this._onLabelClick(val);
            }
        }
    }

    /**
     * Remove every pill except the one with the given value.
     * Calls onRemove for each removed value; the parent re-renders after each call.
     * The remaining pill's remove button receives focus after re-render.
     * @param {string} keepVal
     */
    _removeAllExcept(keepVal) {
        // Collect values before any DOM mutations — the parent will rebuild on each call.
        const toRemove = [...this._el.querySelectorAll('.fg-tag')]
            .map(t => t.dataset.val)
            .filter(v => v !== keepVal);

        for (const v of toRemove) this._onRemove(v);

        // After all re-renders, focus the remaining remove button.
        queueMicrotask(() => {
            this._el
                .querySelector(`.fg-tag[data-val="${CSS.escape(keepVal)}"] .fg-tag-remove`)
                ?.focus();
        });
    }
}
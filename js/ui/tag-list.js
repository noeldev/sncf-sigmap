/**
 * ui/tag-list.js — Removable value tag list.
 *
 * Uses event delegation on the container so render() rebuilds DOM without
 * attaching any per-tag listeners. The delegated handlers are attached once
 * at construction and survive all subsequent replaceChildren() calls.
 *
 * Terminology note:
 *   "Tag" is the code term for these removable badge elements, matching the
 *   CSS classes (.fg-tag) and HTML template (tpl-filter-tag). The UI and
 *   help text may still refer to them as "pills/pastilles" — these are
 *   synonyms in this codebase.
 *
 * Expected tag template structure (tpl-filter-tag):
 *   .fg-tag[data-val]  > .fg-tag-label
 *                        .fg-tag-remove (button)
 *
 * Keyboard contract:
 *   .fg-tag-remove  — Space/Enter → onRemove; Shift+Space/Shift+Enter → remove all others
 *   .fg-tag-label   — Space/Enter → onLabelClick (when onLabelClick is set)
 *
 * Shift+remove semantics: every other tag's onRemove is called; the kept
 * tag's remove button receives focus after the parent re-renders.
 */
export class TagList {
    // ----- Private fields -----
    #el;
    #tpl;
    #onRemove;
    #onLabelClick;

    /**
     * @param {object}   opts
     * @param {Element}  opts.containerEl    Element that holds all tag nodes.
     * @param {Element}  opts.template       <template> for one tag (.fg-tag).
     * @param {Function} opts.onRemove       Called with value when a tag is removed.
     * @param {Function} [opts.onLabelClick] Called with value when the label is activated.
     */
    constructor({ containerEl, template, onRemove, onLabelClick }) {
        this.#el = containerEl;
        this.#tpl = template;
        this.#onRemove = onRemove;
        this.#onLabelClick = onLabelClick ?? null;

        containerEl.addEventListener('mousedown', e => this.#handleMouse(e));
        containerEl.addEventListener('keydown', e => this.#handleKey(e));
    }


    // ===== Public API =====

    /**
     * Rebuild the tag list from an array of values.
     * @param {string[]}                    values
     * @param {(v: string) => string}       [labelFn]   Maps value → display text.
     * @param {(v: string) => string|null}  [tooltipFn] Maps value → native title text.
     */
    render(values, labelFn = v => v, tooltipFn = null) {
        this.#el.replaceChildren();
        for (const v of values) {
            const tag = this.#tpl.content.cloneNode(true).querySelector('.fg-tag');
            tag.dataset.val = v;
            tag.querySelector('.fg-tag-label').textContent = labelFn(v);

            if (tooltipFn) {
                const tip = tooltipFn(v);
                if (tip) tag.setAttribute('title', tip);
            }

            if (this.#onLabelClick) {
                tag.classList.add('fg-tag--clickable');
                const label = tag.querySelector('.fg-tag-label');
                label.setAttribute('tabindex', '0');
                label.setAttribute('role', 'button');
            }

            this.#el.appendChild(tag);
        }
    }

    show() { this.#el.classList.remove('is-hidden'); }
    hide() { this.#el.classList.add('is-hidden'); }


    // ===== Private helpers =====

    #handleMouse(e) {
        this.#processTarget(e.target, e.shiftKey, () => e.preventDefault());
    }

    #handleKey(e) {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        this.#processTarget(e.target, e.shiftKey, () => e.preventDefault());
    }

    /**
     * Route an event to the remove-button handler or the label-click handler.
     * @param {Element}  target
     * @param {boolean}  shiftKey
     * @param {Function} preventDefault
     */
    #processTarget(target, shiftKey, preventDefault) {
        const removeBtn = target.closest('.fg-tag-remove');
        if (removeBtn) {
            preventDefault();
            const val = removeBtn.closest('.fg-tag')?.dataset.val ?? null;
            if (val === null) return;
            if (shiftKey) this.#removeAllExcept(val);
            else this.#onRemove(val);
            return;
        }

        if (this.#onLabelClick) {
            const label = target.closest('.fg-tag-label');
            if (label?.closest('.fg-tag--clickable')) {
                preventDefault();
                const val = label.closest('.fg-tag')?.dataset.val ?? null;
                if (val !== null) this.#onLabelClick(val);
            }
        }
    }

    /**
     * Remove every tag except the one with keepVal.
     * Calls onRemove for each; focuses the remaining remove button after re-render.
     * @param {string} keepVal
     */
    #removeAllExcept(keepVal) {
        const toRemove = [...this.#el.querySelectorAll('.fg-tag')]
            .map(el => el.dataset.val)
            .filter(v => v !== keepVal);
        for (const v of toRemove) this.#onRemove(v);
        queueMicrotask(() => {
            this.#el
                .querySelector(`.fg-tag[data-val="${CSS.escape(keepVal)}"] .fg-tag-remove`)
                ?.focus();
        });
    }
}

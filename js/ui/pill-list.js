/**
 * ui/pill-list.js — Removable value pill (tag) list.
 *
 * Uses event delegation on the container so render() rebuilds DOM without
 * attaching any per-pill listeners.  The two delegated handlers (mousedown +
 * keydown) are attached once at construction and survive all subsequent
 * replaceChildren() calls.
 *
 * Expected pill template structure:
 *   .fg-tag > .fg-tag-label  (value text)
 *             .fg-tag-remove (remove button)
 */
export class PillList {
    /**
     * @param {object}   opts
     * @param {Element}  opts.containerEl — Element that holds all pill nodes.
     * @param {Element}  opts.template    — <template> for one pill.
     * @param {Function} opts.onRemove    — Called with the value string when a
     *                                      pill is removed via click or Space/Enter.
     */
    constructor({ containerEl, template, onRemove }) {
        this._el = containerEl;
        this._tpl = template;

        // Delegated mousedown — fires before blur, so the pill is still focusable
        // when the handler runs.  preventDefault() keeps focus on the pill button
        // rather than moving it to the document before onRemove can redirect it.
        containerEl.addEventListener('mousedown', e => {
            const btn = e.target.closest('.fg-tag-remove');
            if (!btn) return;
            e.preventDefault();
            const val = btn.closest('.fg-tag')
                ?.querySelector('.fg-tag-label')?.textContent ?? null;
            if (val !== null) onRemove(val);
        });

        // Delegated keydown — Space / Enter on any .fg-tag-remove button.
        containerEl.addEventListener('keydown', e => {
            if ((e.key === ' ' || e.key === 'Enter') &&
                e.target.classList.contains('fg-tag-remove')) {
                e.preventDefault();
                const val = e.target.closest('.fg-tag')
                    ?.querySelector('.fg-tag-label')?.textContent ?? null;
                if (val !== null) onRemove(val);
            }
        });
    }

    /**
     * Rebuild the pill list from an iterable of strings.
     * No event listeners are attached to individual pills.
     * @param {Iterable<string>} values
     */
    render(values) {
        this._el.replaceChildren();
        for (const v of values) {
            const pill = this._tpl.content.cloneNode(true).querySelector('.fg-tag');
            pill.querySelector('.fg-tag-label').textContent = v;
            this._el.appendChild(pill);
        }
    }

    show() { this._el.classList.remove('is-hidden'); }
    hide() { this._el.classList.add('is-hidden'); }
    isVisible() { return !this._el.classList.contains('is-hidden'); }
}

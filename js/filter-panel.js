/**
 * ui/filter-panel.js — Single filter panel (DOM + UI controllers).
 *
 * Responsibilities:
 *   - Clone and configure the panel template (IDs, field variants).
 *   - Instantiate Dropdown, ComboBox, and TagList sub-components.
 *   - Wire header buttons (menu, remove, supported-only toggle).
 *   - Expose a typed public API; contain no application state.
 *
 * Does NOT own:
 *   - Active filter values, counts, or sort order (→ filters.js).
 *   - Sibling-dropdown coordination (→ filters.js).
 *   - Clipboard format, MIME types, or copy/paste logic (→ clipboard.js).
 *
 * Clipboard integration:
 *   A chevron button (.fg-menu) in the panel header opens a context menu
 *   via clipboard.js buildTagMenu(). The menu replaces the former Clear button.
 *   Keyboard shortcuts are wired via clipboard.js handleTagsKeydown().
 *   See clipboard.js for the full payload format and paste semantics.
 *
 * Public API:
 *   panel.appendTo(container)
 *   panel.refreshTags(values, tooltipFn?)
 *   panel.refreshList(items)          // {v, count, active, showDot, subtitle?}[]
 *   panel.setInputPlaceholder(text)
 *   panel.openDropdown() / closeDropdown() / isOpen()
 *   panel.focusInput() / focusItem(val)
 *   panel.getFirstItemVal()
 *   panel.clearSearch() / setSearch(value)
 *   panel.panelEl()
 *   panel.destroy()
 */

import { translateElement } from './translation.js';
import { FIELD } from './field-keys.js';
import { Dropdown } from './ui/dropdown.js';
import { ComboBox } from './ui/combobox.js';
import { TagList } from './ui/tag-list.js';
import { buildTagMenu, handleTagsKeydown } from './clipboard.js';


// ===== FilterPanel class =====

export class FilterPanel {
    // ----- Private fields -----
    // field is intentionally public: filters.js reads def.panel.field directly.
    #fieldMeta;
    #tplItem;
    #tplItemRich;
    #tplNoMatch;
    #translateValue;
    #onActivate;
    #onDelete;
    #el;
    #dd;
    #tags;
    #cb;

    /**
     * @param {object}       opts
     * @param {string}       opts.fieldKey
     * @param {object|null}  opts.fieldMeta
     * @param {string}       opts.label
     * @param {HTMLElement}  opts.tplGroup
     * @param {HTMLElement}  opts.tplTag
     * @param {HTMLElement}  opts.tplItem
     * @param {HTMLElement}  opts.tplItemRich
     * @param {HTMLElement}  opts.tplNoMatch
     * @param {boolean}      opts.isConfirmed
     * @param {string}       opts.searchValue
     * @param {boolean}      opts.mappedOnly
     * @param {Function}     [opts.translateValue]
     * @param {Function}     opts.onActivate
     * @param {Function}     opts.onTagRemove
     * @param {Function}     [opts.onTagLabelClick]
     * @param {Function}     [opts.onTagHover]
     * @param {Function}     opts.onDelete
     * @param {Function}     opts.onRemove
     * @param {Function}     [opts.onToggleMappedOnly]
     * @param {Function}     opts.onSearch
     * @param {Function}     opts.onEnter
     * @param {Function}     opts.onOpen
     */
    constructor(opts) {
        this.field = opts.fieldKey;
        this.#fieldMeta = opts.fieldMeta;
        this.#tplItem = opts.tplItem;
        this.#tplItemRich = opts.tplItemRich;
        this.#tplNoMatch = opts.tplNoMatch;
        this.#translateValue = opts.translateValue ?? ((_, v) => v);
        this.#onActivate = opts.onActivate;
        this.#onDelete = opts.onDelete;

        this.#el = this.#cloneTemplate(opts.tplGroup, opts.fieldKey);
        this.#applyFieldVariants(this.#el, opts);
        this.#initSubComponents(opts);
        this.#bindEvents(opts);
    }


    // ===== Private initialisation =====

    #initSubComponents({ fieldMeta, onActivate, onTagRemove, onTagLabelClick, onTagHover,
        onSearch, onEnter, onOpen, tplTag }) {
        this.#dd = new Dropdown({
            dropdownEl: this.#el.dropdown,
            triggerEl: this.#el.comboInput,
            listEl: this.#el.list,
            input: this.#el.input,
            itemSel: '.fg-drop-item',
            onActivate,
            activationFocusMode: fieldMeta?.minSearch > 0 ? 'input' : 'item',
        });

        this.#tags = new TagList({
            containerEl: this.#el.tags,
            template: tplTag,
            onRemove: onTagRemove,
            onLabelClick: onTagLabelClick,
            onTagHover,
        });

        this.#cb = new ComboBox({
            inputEl: this.#el.input,
            comboWrapEl: this.#el.comboInput,
            clearButtonEl: this.#el.comboClear ?? undefined,
            arrowButtonEl: this.#el.comboArrow ?? undefined,
            dropdown: this.#dd,
            onSearch,
            onEnter,
            onOpen,
            numericOnly: fieldMeta?.numericOnly ?? false,
            searchTransform: fieldMeta?.labelSearch ? (v => v) : undefined,
        });
    }

    #bindEvents({ fieldKey, onActivate, onRemove, onToggleMappedOnly }) {
        // Delegated mousedown on the list — survives replaceChildren() in refreshList().
        this.#el.list.addEventListener('mousedown', e => {
            const item = e.target.closest('.fg-drop-item');
            if (!item) return;
            e.preventDefault();
            onActivate(item.dataset.val);
        });

        // Menu button: open clipboard context menu via clipboard.js.
        this.#el.menuBtn.addEventListener('click', () => {
            buildTagMenu(this.#el.menuBtn, {
                dataType: this.field,
                getValues: () => this.#tags.getValues(),
                onDelete: () => this.#onDelete?.(),
                onPaste: this.#onPasteTags,
            });
        });

        this.#el.removeBtn.addEventListener('click', onRemove);

        if (fieldKey === FIELD.SIGNAL_TYPE && onToggleMappedOnly) {
            this.#el.toggleChk.addEventListener('change', () =>
                onToggleMappedOnly(this.#el.toggleChk.checked));
        }

        // Keyboard shortcuts — mirror context menu actions when tag list has focus.
        this.#el.tags.addEventListener('keydown', e => {
            handleTagsKeydown(e, {
                dataType: this.field,
                getValues: () => this.#tags.getValues(),
                onDelete: () => this.#onDelete?.(),
                onPaste: this.#onPasteTags,
            });
        });
    }

    /** Sync the clear-input button visibility with the current input value. */
    #syncClearButton() {
        const { comboClear, input } = this.#el;
        if (comboClear) comboClear.classList.toggle('is-hidden', input.value.length === 0);
    }

    /**
     * Activate new values pasted from the clipboard.
     * Defined as a private arrow field so it can be passed as a callback
     * reference without losing the `this` binding.
     * Called by buildTagMenu and handleTagsKeydown in clipboard.js with
     * already-deduplicated values — no risk of toggling off an active entry.
     */
    #onPasteTags = newVals => {
        for (const v of newVals) this.#onActivate?.(v);
    };


    // ===== Public API =====

    /** @param {HTMLElement} container */
    appendTo(container) { container.appendChild(this.#el.panel); }

    /** Return the root element for registerPanel() in collapsible-panel.js. */
    panelEl() { return this.#el.panel; }


    /* ----- List rendering ----- */

    /**
     * Rebuild the dropdown item list.
     *
     * Item shape: { v, count, active, showDot, subtitle? }
     *   subtitle — optional secondary text (line label). When present:
     *     - Renders as a small dim span inside the item.
     *     - A native title tooltip shows the full "code — label" string.
     *
     * Focus is restored via queueMicrotask after replaceChildren() moves it to <body>.
     *
     * @param {Array<{v:string, count:number, active:boolean, showDot:boolean, subtitle?:string|null}>} items
     */
    refreshList(items) {
        const list = this.#el.list;
        const prevFocusedVal = list.contains(document.activeElement)
            ? document.activeElement.dataset?.val ?? null
            : null;

        list.replaceChildren();

        if (!items.length) {
            const placeholder = this.#tplNoMatch.content
                .cloneNode(true).querySelector('.fg-empty');
            translateElement(placeholder);
            list.appendChild(placeholder);
            return;
        }

        for (const { v, count, active, showDot, subtitle } of items) {
            const tpl = subtitle ? this.#tplItemRich : this.#tplItem;
            const item = tpl.content.cloneNode(true).querySelector('.fg-drop-item');
            const nameEl = item.querySelector('.fgi-name');
            const displayVal = this.#translateValue(this.field, v);

            if (subtitle) {
                const codeSpan = nameEl.querySelector('.fgi-code');
                const subSpan = nameEl.querySelector('.fgi-subtitle');
                if (codeSpan) codeSpan.textContent = displayVal;
                if (subSpan) subSpan.textContent = subtitle;
                item.title = `${v} \u2014 ${subtitle}`;
            } else {
                nameEl.textContent = displayVal;
            }

            item.setAttribute('aria-selected', String(active));
            item.classList.toggle('active', active);
            item.classList.toggle('mapped', showDot);
            item.dataset.field = this.field;
            item.dataset.val = v;
            item.querySelector('.fgi-check').classList.toggle('checked', active);
            item.querySelector('.fgi-count').textContent =
                count > 0 ? count.toLocaleString() : '';
            list.appendChild(item);
        }

        if (prevFocusedVal && this.#dd.isOpen()) {
            queueMicrotask(() => this.#dd.focusItem(prevFocusedVal));
        }
    }


    /* ----- Tags ----- */

    /**
     * Rebuild the active-value tag list.
     * @param {string[]} values
     * @param {Function|null} [tooltipFn]  tooltipFn(val) → string|null
     */
    refreshTags(values, tooltipFn = null) {
        this.#tags.render(values, v => this.#translateValue(this.field, v), tooltipFn);
    }


    /* ----- Input ----- */

    /** @param {string} text */
    setInputPlaceholder(text) { this.#el.input.placeholder = text; }

    /** Clear the search input and sync the clear button. */
    clearSearch() {
        this.#el.input.value = '';
        this.#syncClearButton();
    }

    /**
     * Set the input value programmatically and sync the clear button.
     * @param {string} value
     */
    setSearch(value) {
        this.#el.input.value = value;
        this.#syncClearButton();
    }


    /* ----- Dropdown state ----- */

    openDropdown() { this.#dd.open(); }
    closeDropdown() { this.#dd.close(); }
    isOpen() { return this.#dd.isOpen(); }


    /* ----- Focus ----- */

    focusInput() { this.#dd.focusInput(); }
    focusItem(val) { this.#dd.focusItem(val); }


    /* ----- Utility ----- */

    /** @returns {string|null} */
    getFirstItemVal() {
        return this.#el.list.querySelector('.fg-drop-item')?.dataset.val ?? null;
    }


    /* ----- Lifecycle ----- */

    /** Unregister Dropdown and detach its keydown handler before removing from DOM. */
    destroy() { this.#dd.destroy(); }


    // ===== Private helpers =====

    #cloneTemplate(tplGroup, fieldKey) {
        const panel = tplGroup.content.cloneNode(true).querySelector('.filter-panel');
        translateElement(panel);

        panel.id = `filter-panel-${fieldKey}`;
        const body = panel.querySelector('.cp-body');
        const summary = panel.querySelector('.fg-header');
        if (body) body.id = `filter-body-${fieldKey}`;
        if (summary) summary.setAttribute('aria-controls', `filter-body-${fieldKey}`);

        const input = panel.querySelector('.fg-search');
        input.name = fieldKey;
        input.id = `fg-search-${fieldKey}`;

        return {
            panel,
            title: panel.querySelector('.fg-title'),
            menuBtn: panel.querySelector('.fg-menu'),
            removeBtn: panel.querySelector('.fg-remove'),
            tags: panel.querySelector('.fg-tags'),
            comboInput: panel.querySelector('.fg-combo-input'),
            comboArrow: panel.querySelector('.fg-combo-arrow'),
            comboClear: panel.querySelector('.fg-combo-clear'),
            input,
            dropdown: panel.querySelector('.fg-dropdown'),
            list: panel.querySelector('.fg-dropdown-inner'),
            toggleRow: panel.querySelector('.supported-only-row'),
            toggleChk: panel.querySelector('.chk-mapped-only'),
        };
    }

    #applyFieldVariants(el, { fieldKey, fieldMeta, label, isConfirmed, searchValue, mappedOnly }) {
        el.title.textContent = label;

        if (fieldKey === FIELD.SIGNAL_TYPE) {
            el.toggleRow.classList.remove('is-hidden');
            el.toggleChk.checked = mappedOnly;
        }

        if (fieldMeta?.minSearch > 0) {
            el.comboArrow?.classList.add('is-hidden');
            el.comboClear?.classList.add('is-hidden');
            if (!isConfirmed) {
                el.tags.classList.add('is-hidden');
                el.input.value = searchValue;
            }
        }

        if (fieldMeta?.readOnly) {
            el.input.readOnly = true;
            el.comboInput.classList.add('fg-combo-readonly');
            el.comboClear?.classList.add('is-hidden');
            el.comboArrow?.classList.remove('is-hidden');
        }

        if (fieldMeta?.numericOnly) {
            el.input.inputMode = 'numeric';
            el.input.pattern = '[0-9]*';
        }

        if (fieldMeta?.labelSearch) {
            el.input.classList.add('fg-search--mixed');
        }
    }
}

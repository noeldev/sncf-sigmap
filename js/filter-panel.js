/**
 * ui/filter-panel.js — Single filter panel (DOM + UI controllers).
 *
 * FilterPanel owns:
 * - DOM creation from the tpl-filter-group template and element caching.
 * - One Dropdown, one ComboBox, one PillList instance.
 * - Delegated mousedown on the item list (shared activation path for mouse).
 * - clearBtn / removeBtn / toggleChk event wiring.
 *
 * FilterPanel does NOT own:
 * - Application state (_activeFilters, _counts, _confirmedFilters…).
 * - Data preparation (filtering / sorting item arrays).
 * - Sibling-dropdown coordination.
 *
 * All application-specific behaviour is injected via callbacks so that
 * FilterPanel remains a pure UI component.
 *
 * Public API:
 *   panel.appendTo(container)
 *   panel.refreshTags(activeVals)
 *   panel.refreshList(items)        // [{v, count, active, showDot}]
 *   panel.showHint(text)            // minSearch waiting state
 *   panel.setInputPlaceholder(text)
 *   panel.openDropdown() / panel.closeDropdown() / panel.isOpen()
 *   panel.focusInput() / panel.focusItem(val)
 *   panel.getFirstItemVal()
 *   panel.clearSearch()
 *   panel.setSearch(value)
 *   panel.destroy()
 */

import { translateElement } from './translation.js';
import { Dropdown } from './ui/dropdown.js';
import { ComboBox } from './ui/combobox.js';
import { PillList } from './ui/pill-list.js';

export class FilterPanel {
    /**
     * @param {object}        opts
     * @param {string}        opts.fieldKey
     * @param {object|null}   opts.fieldMeta
     * @param {string}        opts.label
     * @param {HTMLElement}   opts.tplGroup
     * @param {HTMLElement}   opts.tplTag
     * @param {HTMLElement}   opts.tplItem
     * @param {HTMLElement}   opts.tplNoMatch
     * @param {boolean}       opts.isConfirmed
     * @param {string}        opts.searchValue
     * @param {boolean}       opts.mappedOnly
     * @param {Function}      [opts.translateValue]
     * @param {Function}      opts.onActivate
     * @param {Function}      opts.onPillRemove
     * @param {Function}      [opts.onPillLabelClick]
     * @param {Function}      opts.onClear
     * @param {Function}      opts.onRemove
     * @param {Function}      [opts.onToggleMappedOnly]
     * @param {Function}      opts.onSearch
     * @param {Function}      opts.onEnter
     * @param {Function}      opts.onOpen
     */
    constructor(opts) {
        this.field = opts.fieldKey;
        this._fieldMeta = opts.fieldMeta;
        this._tplItem = opts.tplItem;
        this._tplNoMatch = opts.tplNoMatch;
        // translateValue(field, val) → localized display string or raw val.
        this._translateValue = opts.translateValue ?? ((f, v) => v);

        this._buildDOM(opts);
        this._initSubComponents(opts);
        this._bindEvents(opts);
    }


    /* ===== Private initialisation ===== */

    /**
     * Clone the filter-panel template, apply i18n, and cache element references.
     * Also applies field-specific DOM mutations (signalType toggle, minSearch,
     * readOnly, numericOnly).
     */
    _buildDOM({ tplGroup, fieldKey, fieldMeta, label, isConfirmed, searchValue, mappedOnly }) {
        const panel = tplGroup.content.cloneNode(true).querySelector('.filter-panel');
        translateElement(panel);

        // Assign unique IDs for the cp-panel collapsible system.
        const panelId = `filter-panel-${fieldKey}`;
        const bodyId = `filter-body-${fieldKey}`;
        panel.id = panelId;

        // Wire the summary aria-controls to the cp-body.
        // The simplified template has no fg-body wrapper — the cp-body is direct child.
        const summary = panel.querySelector('.fg-header');
        const body = panel.querySelector('.cp-body');
        if (summary) summary.setAttribute('aria-controls', bodyId);
        if (body) body.id = bodyId;

        this._el = {
            panel,
            title: panel.querySelector('.fg-title'),
            clearBtn: panel.querySelector('.fg-clear'),
            removeBtn: panel.querySelector('.fg-remove'),
            tags: panel.querySelector('.fg-tags'),
            // fg-combo-input is now a direct child of cp-body (no .fg-combo wrapper)
            comboInput: panel.querySelector('.fg-combo-input'),
            comboArrow: panel.querySelector('.fg-combo-arrow'),
            input: panel.querySelector('.fg-search'),
            dropdown: panel.querySelector('.fg-dropdown'),
            list: panel.querySelector('.fg-dropdown-inner'),
            toggleRow: panel.querySelector('.supported-only-row'),
            toggleChk: panel.querySelector('.chk-mapped-only'),
        };

        this._el.title.textContent = label;

        // signalType: reveal and set the "Supported types only" toggle.
        if (fieldKey === 'signalType') {
            this._el.toggleRow.classList.remove('is-hidden');
            this._el.toggleChk.checked = mappedOnly;
        }

        // minSearch: hide arrow (free-text, not a dropdown) and optionally tags.
        if (fieldMeta?.minSearch > 0) {
            this._el.comboArrow.classList.add('is-hidden');
            if (!isConfirmed) {
                this._el.tags.classList.add('is-hidden');
                this._el.input.value = searchValue;
            }
        }

        // readOnly (direction, placement — small fixed value sets).
        if (fieldMeta?.readOnly) {
            this._el.input.readOnly = true;
            this._el.comboInput.classList.add('fg-combo-readonly');
        }

        // numericOnly — better UX on mobile/tablet.
        if (fieldMeta?.numericOnly) {
            this._el.input.inputMode = 'numeric';
            this._el.input.pattern = '[0-9]*';
        }
    }

    /**
     * Instantiate Dropdown, PillList, and ComboBox sub-components.
     */
    _initSubComponents({ fieldMeta, onActivate, onPillRemove, onPillLabelClick,
        onSearch, onEnter, onOpen, tplTag }) {
        this.dd = new Dropdown({
            dropdownEl: this._el.dropdown,
            triggerEl: this._el.comboInput,
            listEl: this._el.list,
            input: this._el.input,
            itemSel: '.fg-drop-item',
            onActivate,
            activationFocusMode: fieldMeta?.minSearch > 0 ? 'input' : 'item',
        });

        this.pills = new PillList({
            containerEl: this._el.tags,
            template: tplTag,
            onRemove: onPillRemove,
            onLabelClick: onPillLabelClick,
        });

        this.cb = new ComboBox({
            inputEl: this._el.input,
            comboWrapEl: this._el.comboInput,
            dropdown: this.dd,
            onSearch,
            onEnter,
            onOpen,
            // numericOnly is mutually exclusive with readOnly.
            numericOnly: fieldMeta?.numericOnly ?? false,
        });
    }

    /**
     * Attach all event listeners: item activation (delegated), clear, remove,
     * and the signalType "Supported only" toggle.
     */
    _bindEvents({ fieldKey, onActivate, onClear, onRemove, onToggleMappedOnly }) {
        // Delegated mousedown on the list — survives replaceChildren() in refreshList().
        this._el.list.addEventListener('mousedown', e => {
            const item = e.target.closest('.fg-drop-item');
            if (!item) return;
            e.preventDefault();
            onActivate(item.dataset.val);
        });

        // Clear values button (trash) — remove active values, keep panel open.
        if (this._el.clearBtn) {
            this._el.clearBtn.addEventListener('click', () => onClear?.());
        }

        // Remove panel button (×) — destroy the entire filter panel.
        this._el.removeBtn.addEventListener('click', onRemove);

        // signalType supported-only toggle.
        if (fieldKey === 'signalType' && onToggleMappedOnly) {
            this._el.toggleChk.addEventListener('change', () => {
                onToggleMappedOnly(this._el.toggleChk.checked);
            });
        }
    }


    /* ===== Public API ===== */

    /**
     * Append the panel element to a container. 
     * @param {HTMLElement} container
     */
    appendTo(container) {
        container.appendChild(this._el.panel);
    }

    /** Return the root panel element (for registerPanel in collapsible-panel.js). */
    panelEl() { return this._el.panel; }

    /**
     * Show or hide the clear (trash) button based on whether there are active pills.
     * @param {boolean} visible
     */
    toggleClearBtn(visible) {
        this._el.clearBtn?.classList.toggle('is-hidden', !visible);
    }

    /* ----- List rendering ----- */

    /**
     * Rebuild the dropdown item list.
     * Renders the no-match placeholder when items is empty.
     *
     * Focus restoration: if an item had keyboard focus before the rebuild,
     * queueMicrotask refocuses it after replaceChildren() moves focus to <body>.
     *
     * @param {Array<{v: string, count: number, active: boolean, showDot: boolean}>} items
     */
    refreshList(items) {
        const list = this._el.list;

        const prevFocusedVal = list.contains(document.activeElement)
            ? document.activeElement.dataset?.val ?? null
            : null;

        list.replaceChildren();

        if (!items.length) {
            const placeholder = this._tplNoMatch.content
                .cloneNode(true).querySelector('.fg-empty');
            translateElement(placeholder);
            list.appendChild(placeholder);
            return;
        }

        for (const { v, count, active, showDot } of items) {
            const item = this._tplItem.content
                .cloneNode(true).querySelector('.fg-drop-item');
            item.tabIndex = -1;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(active));
            item.classList.toggle('active', active);
            item.classList.toggle('mapped', showDot);
            item.dataset.field = this.field;
            item.dataset.val = v;
            item.querySelector('.fgi-check').classList.toggle('checked', active);
            item.querySelector('.fgi-name').textContent = this._translateValue(this.field, v);
            item.querySelector('.fgi-count').textContent = count > 0 ? count.toLocaleString() : '';
            list.appendChild(item);
        }

        if (prevFocusedVal && this.dd.isOpen()) {
            queueMicrotask(() => this.dd.focusItem(prevFocusedVal));
        }
    }

    /**
     * Show a single hint row (minSearch threshold not yet reached).
     * @param {string} text
     */
    showHint(text) {
        const hint = this._tplNoMatch.content.cloneNode(true).querySelector('.fg-empty');
        // Prevent translateElement from overwriting this dynamically-set text.
        hint.removeAttribute('data-i18n');
        hint.textContent = text;
        this._el.list.replaceChildren(hint);
    }


    /* ----- Pills ----- */

    /** Rebuild the pill list, displaying translated labels for coded values. */
    refreshTags(values) {
        this.pills.render(values, v => this._translateValue(this.field, v));
    }

    showTags() { this.pills.show(); }
    hideTags() { this.pills.hide(); }


    /* ----- Input ----- */

    /** Update the input placeholder text. */
    setInputPlaceholder(text) { this._el.input.placeholder = text; }

    /** Reset the input value to an empty string. */
    clearSearch() { this._el.input.value = ''; }

    /**
     * Set the input value to an arbitrary string.
     * Used by filters.js when numericOnly sanitization produces a value that
     * differs from what was typed, so the visible input stays in sync.
     * @param {string} value
     */
    setSearch(value) { this._el.input.value = value; }


    /* ----- Dropdown state ----- */

    openDropdown() { this.dd.open(); }
    closeDropdown() { this.dd.close(); }
    isOpen() { return this.dd.isOpen(); }


    /* ----- Focus ----- */

    focusInput() { this.dd.focusInput(); }
    focusItem(val) { this.dd.focusItem(val); }


    /* ----- Utility ----- */

    /** Return the data-val of the first list item, or null if the list is empty. */
    getFirstItemVal() {
        return this._el.list.querySelector('.fg-drop-item')?.dataset.val ?? null;
    }


    /* ----- Lifecycle ----- */

    /**
     * Unregister the Dropdown from the outside-click registry and detach its
     * keydown handler. Must be called before removing the panel from the DOM.
     */
    destroy() { this.dd.destroy(); }
}

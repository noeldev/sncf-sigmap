/**
 * ui/filter-panel.js — Single filter panel (DOM + UI controllers).
 *
 * FilterPanel owns:
 *   • DOM creation from the tpl-filter-group template and element caching.
 *   • One Dropdown, one ComboBox, one PillList instance.
 *   • Delegated mousedown on the item list (shared activation path for mouse).
 *   • removeBtn "click" and toggleChk "change" (type_if only) listeners.
 *
 * FilterPanel does NOT own:
 *   • Application state (_activeFilters, _counts, _confirmedFilters…).
 *   • Data preparation (filtering / sorting item arrays).
 *   • Sibling-dropdown coordination.
 *
 * All application-specific behaviour is injected via callbacks so that
 * FilterPanel remains a pure UI component.
 *
 * Typical usage in filters.js:
 *
 *   const panel = new FilterPanel({ fieldKey, fieldMeta, label,
 *                                   tplGroup, tplTag, tplItem, tplNoMatch,
 *                                   applyI18n, isConfirmed, searchValue,
 *                                   mappedOnly,
 *                                   onActivate, onPillRemove, onRemove,
 *                                   onToggleMappedOnly, onSearch, onEnter, onOpen });
 *   panel.appendTo(container);
 *   panel.refreshTags(activeVals);
 *   panel.refreshList(items);           // [{v, count, active, showDot}]
 *   panel.showHint(text);               // minSearch waiting state
 *   panel.setInputPlaceholder(text);
 *   panel.showTags() / panel.hideTags();
 *   panel.openDropdown() / panel.closeDropdown();
 *   panel.focusInput() / panel.focusItem(val);
 *   panel.getFirstItemVal();            // for _selectFirst
 *   panel.clearSearch();                // resets input value to ''
 *   panel.destroy();                    // unregisters Dropdown on removal
 */

import { Dropdown  } from './dropdown.js';
import { ComboBox  } from './combobox.js';
import { PillList  } from './pill-list.js';

export class FilterPanel {
    /**
     * @param {object}        opts
     * @param {string}        opts.fieldKey          — Field identifier (e.g. 'type_if').
     * @param {object|null}   opts.fieldMeta         — Entry from ALL_FILTER_FIELDS.
     * @param {string}        opts.label             — Translated field label.
     * @param {HTMLElement}   opts.tplGroup          — <template id="tpl-filter-group">.
     * @param {HTMLElement}   opts.tplTag            — <template id="tpl-filter-tag">.
     * @param {HTMLElement}   opts.tplItem           — <template id="tpl-filter-drop-item">.
     * @param {HTMLElement}   opts.tplNoMatch        — <template id="tpl-filter-no-match">.
     * @param {Function}      opts.applyI18n         — applyI18n(element) from i18n.js.
     * @param {boolean}       opts.isConfirmed       — Whether field is in _confirmedFilters.
     * @param {string}        opts.searchValue       — Partial query to restore in input.
     * @param {boolean}       opts.mappedOnly        — Current _mappedOnly flag (type_if).
     * @param {Function}      opts.onActivate        — (val) => void — item selected.
     * @param {Function}      opts.onPillRemove      — (val) => void — pill × clicked.
     * @param {Function}      opts.onRemove          — ()    => void — panel × clicked.
     * @param {Function}      [opts.onToggleMappedOnly] — (checked) => void (type_if).
     * @param {Function}      opts.onSearch          — (query: string) => void.
     * @param {Function}      opts.onEnter           — ()    => void — Enter in input.
     * @param {Function}      opts.onOpen            — ()    => void — open this panel
     *                                                 (close siblings first).
     */
    constructor({ fieldKey, fieldMeta, label,
                  tplGroup, tplTag, tplItem, tplNoMatch, applyI18n,
                  isConfirmed, searchValue, mappedOnly,
                  onActivate, onPillRemove, onRemove, onToggleMappedOnly,
                  onSearch, onEnter, onOpen }) {

        this.field      = fieldKey;
        this._fieldMeta = fieldMeta;
        this._tplItem   = tplItem;
        this._tplNoMatch = tplNoMatch;
        this._applyI18n = applyI18n;

        // ---- Clone template and cache elements ----
        const panel = tplGroup.content.cloneNode(true).querySelector('.filter-group');
        applyI18n(panel);   // translate data-i18n attributes (e.g. toggle label)

        this._el = {
            panel,
            title:       panel.querySelector('.fg-title'),
            removeBtn:   panel.querySelector('.fg-remove'),
            tags:        panel.querySelector('.fg-tags'),
            comboInput:  panel.querySelector('.fg-combo-input'),
            comboArrow:  panel.querySelector('.fg-combo-arrow'),
            input:       panel.querySelector('.fg-search'),
            dropdown:    panel.querySelector('.fg-dropdown'),
            list:        panel.querySelector('.fg-dropdown-inner'),
            toggleRow:   panel.querySelector('.supported-only-row'),
            toggleChk:   panel.querySelector('.chk-mapped-only'),
            toggleTrack: panel.querySelector('.toggle-track'),
        };

        this._el.title.textContent = label;

        // ---- type_if toggle ----
        if (fieldKey === 'type_if') {
            this._el.toggleRow.classList.remove('is-hidden');
            this._el.toggleChk.checked = mappedOnly;
            this._el.toggleTrack.classList.toggle('checked', mappedOnly);
        }

        // ---- minSearch setup ----
        if (fieldMeta?.minSearch > 0) {
            this._el.comboArrow.classList.add('is-hidden');
            if (!isConfirmed) {
                this._el.tags.classList.add('is-hidden');
                this._el.input.value = searchValue;
            }
        }

        // ---- Dropdown ----
        // onActivate is defined before the constructor call in _buildPanels,
        // so there is no TDZ risk here.
        this.dd = new Dropdown({
            dropdownEl:          this._el.dropdown,
            triggerEl:           this._el.comboInput,
            listEl:              this._el.list,
            input:               this._el.input,
            itemSel:             '.fg-drop-item',
            onActivate,
            activationFocusMode: fieldMeta?.minSearch > 0 ? 'input' : 'item',
        });

        // ---- PillList ----
        this.pills = new PillList({
            containerEl: this._el.tags,
            template:    tplTag,
            onRemove:    onPillRemove,
        });

        // ---- ComboBox ----
        this.cb = new ComboBox({
            inputEl:     this._el.input,
            comboWrapEl: this._el.comboInput,
            dropdown:    this.dd,
            onSearch,
            onEnter,
            onOpen,
        });

        // ---- Item activation (delegated mousedown on list) ----
        // Delegation survives replaceChildren() — refreshList() builds DOM only.
        this._el.list.addEventListener('mousedown', e => {
            const item = e.target.closest('.fg-drop-item');
            if (!item) return;
            e.preventDefault();
            onActivate(item.dataset.val);
        });

        // ---- Remove panel button ----
        this._el.removeBtn.addEventListener('click', onRemove);

        // ---- type_if toggle change ----
        if (fieldKey === 'type_if' && onToggleMappedOnly) {
            this._el.toggleChk.addEventListener('change', () => {
                const checked = this._el.toggleChk.checked;
                this._el.toggleTrack.classList.toggle('checked', checked);
                onToggleMappedOnly(checked);
            });
        }
    }

    /* ----- DOM ----- */

    /** Append the panel to a container element. */
    appendTo(container) { container.appendChild(this._el.panel); }

    /* ----- List rendering ----- */

    /**
     * Rebuild the dropdown item list.
     *
     * When items is empty, renders the no-match placeholder.
     * Call showHint() instead when the minSearch threshold is not yet reached.
     *
     * Focus restoration: if an item had keyboard focus before the rebuild,
     * queueMicrotask refocuses the rebuilt item after replaceChildren() moves
     * browser focus to <body>.
     *
     * @param {Array<{v: string, count: number, active: boolean, showDot: boolean}>} items
     */
    refreshList(items) {
        const list = this._el.list;

        // Save focused item val before replaceChildren() detaches it.
        const prevFocusedVal = list.contains(document.activeElement)
            ? document.activeElement.dataset?.val ?? null
            : null;

        list.replaceChildren();

        if (!items.length) {
            const placeholder = this._tplNoMatch.content
                .cloneNode(true).querySelector('.fg-empty');
            this._applyI18n(placeholder);
            list.appendChild(placeholder);
            return;
        }

        for (const { v, count, active, showDot } of items) {
            const item = this._tplItem.content
                .cloneNode(true).querySelector('.fg-drop-item');
            item.tabIndex = -1;
            item.setAttribute('role',          'option');
            item.setAttribute('aria-selected', String(active));
            item.classList.toggle('active', active);
            item.classList.toggle('mapped', showDot);
            item.dataset.field = this.field;
            item.dataset.val   = v;
            item.querySelector('.fgi-check').classList.toggle('checked', active);
            item.querySelector('.fgi-name').textContent  = v;
            item.querySelector('.fgi-count').textContent = count > 0 ? count.toLocaleString() : '';
            list.appendChild(item);
        }

        // Restore keyboard focus after replaceChildren() moved it to <body>.
        if (prevFocusedVal && this.dd.isOpen())
            queueMicrotask(() => this.dd.focusItem(prevFocusedVal));
    }

    /**
     * Show a single hint row (minSearch threshold not yet reached).
     * @param {string} text
     */
    showHint(text) {
        const hint = document.createElement('div');
        hint.className   = 'fg-empty';
        hint.textContent = text;
        this._el.list.replaceChildren(hint);
    }

    /* ----- Pills ----- */

    /** Rebuild the pill list from an iterable of value strings. */
    refreshTags(values) { this.pills.render(values); }

    showTags() { this.pills.show(); }
    hideTags() { this.pills.hide(); }

    /* ----- Input ----- */

    /** Update the input placeholder text. */
    setInputPlaceholder(text) { this._el.input.placeholder = text; }

    /** Reset the input value to an empty string. */
    clearSearch() { this._el.input.value = ''; }

    /* ----- Dropdown state ----- */

    openDropdown()  { this.dd.open(); }
    closeDropdown() { this.dd.close(); }
    isOpen()        { return this.dd.isOpen(); }

    /* ----- Focus ----- */

    focusInput()     { this.dd.focusInput(); }
    focusItem(val)   { this.dd.focusItem(val); }

    /* ----- Utility ----- */

    /** Return the data-val of the first list item, or null if the list is empty. */
    getFirstItemVal() {
        return this._el.list.querySelector('.fg-drop-item')?.dataset.val ?? null;
    }

    /* ----- Lifecycle ----- */

    /**
     * Unregister the Dropdown from the outside-click registry and remove its
     * keydown handler.  Must be called before removing the panel from the DOM.
     */
    destroy() { this.dd.destroy(); }
}

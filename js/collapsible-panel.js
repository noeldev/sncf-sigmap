/**
 * collapsible-panel.js — Shared collapsible panel controller.
 *
 * Manages all .cp-panel elements across every sidebar tab using a single
 * delegated event listener. Each panel consists of:
 *   .panel-summary[role="button"][aria-expanded][aria-controls] — clickable header
 *   .cp-body[id] — collapsible content
 *
 * Panel open/closed state is persisted in localStorage so user preferences
 * survive tab switches and page reloads.
 *
 * Public API:
 *   initCollapsiblePanels() — call once after DOM is ready.
 *   registerPanel(panel)    — apply persisted state to a dynamically created panel.
 *   unregisterPanel(panel)  — delete persisted state when a panel is removed.
 *   openPanel(panel)        — force a panel open and persist the open state.
 */

const STORAGE_KEY = 'panel-states';

/** Map of panelId → boolean (true = open). */
let _states = {};

/**
 * Initialise all collapsible panels.
 * Must be called after the DOM is fully parsed (app.js/_initUI).
 */
export function initCollapsiblePanels() {
    _loadStates();
    _applyAll();
    _bindEvents();
}

/**
 * Apply persisted open/closed state to a single panel.
 * Falls back to the HTML default (cp-panel--open class) when no state is stored.
 * @param {Element} panel
 */
export function registerPanel(panel) {
    const id = panel.id;
    if (!id) return;
    if (Object.prototype.hasOwnProperty.call(_states, id)) {
        _setOpen(panel, _states[id], false);
    } else {
        const defaultOpen = panel.classList.contains('cp-panel--open');
        _states[id] = defaultOpen;
        _setOpen(panel, defaultOpen, false);
    }
}

/**
 * Remove a panel's persisted state.
 * Call this when a dynamically created panel is destroyed so stale state
 * does not affect a panel with the same id added later.
 * @param {Element} panel
 */
export function unregisterPanel(panel) {
    const id = panel.id;
    if (!id || !Object.prototype.hasOwnProperty.call(_states, id)) return;
    delete _states[id];
    _saveStates();
}

/**
 * Force a panel open and persist the open state.
 * Use when the user explicitly creates a new panel (e.g. "Add filter") to
 * guarantee it opens regardless of any stale persisted closed state.
 * @param {Element} panel
 */
export function openPanel(panel) {
    if (!panel) return;
    _setOpen(panel, true, true);
}

// ===== Private helpers =====

function _loadStates() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        _states = raw ? JSON.parse(raw) : {};
    } catch {
        _states = {};
    }
}

function _saveStates() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_states));
    } catch { }
}

/** Apply persisted state to every .cp-panel in the document. */
function _applyAll() {
    document.querySelectorAll('.cp-panel').forEach(panel => {
        const id = panel.id;
        if (!id) return;
        // If a stored state exists use it; otherwise keep the HTML default.
        if (Object.prototype.hasOwnProperty.call(_states, id)) {
            _setOpen(panel, _states[id], false);
        } else {
            // Read the HTML default (cp-panel--open class) and record it.
            const defaultOpen = panel.classList.contains('cp-panel--open');
            _states[id] = defaultOpen;
            _setOpen(panel, defaultOpen, false);
        }
    });
}

/** Toggle a panel open/closed, persist, and update ARIA. */
function _toggle(panel) {
    const isOpen = panel.classList.contains('cp-panel--open');
    _setOpen(panel, !isOpen, true);
    // Scroll the newly opened panel into view (useful for panels near the bottom
    // of a scrollable tab, e.g. Legend or the last filter panel).
    if (!isOpen) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

/**
 * Set a panel's open state.
 * @param {Element} panel
 * @param {boolean} open
 * @param {boolean} persist  — true to write to localStorage
 */
function _setOpen(panel, open, persist) {
    const id = panel.id;
    const summary = panel.querySelector('.panel-summary[aria-controls]');
    const body = panel.querySelector('.cp-body');

    panel.classList.toggle('cp-panel--open', open);
    if (summary) summary.setAttribute('aria-expanded', String(open));
    if (body) body.hidden = !open;

    if (persist) {
        _states[id] = open;
        _saveStates();
    }
}

/** Single delegated listener on the sidebar for all panel headers. */
function _bindEvents() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.addEventListener('click', e => {
        // Action buttons inside a summary (e.g. clear-pins, fg-remove) must not toggle.
        if (e.target.closest('.summary-action-btn, .fg-actions, .fg-combo-action, .summary-link-btn')) return;
        const summary = e.target.closest('.panel-summary[aria-controls]');
        if (!summary) return;
        const panel = summary.closest('.cp-panel');
        if (panel) _toggle(panel);
    });

    sidebar.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('.summary-action-btn, .fg-actions, .fg-combo-action, .summary-link-btn')) return;
        e.preventDefault();
        const panel = e.target.closest('.cp-panel');
        if (panel) _toggle(panel);
    });
}

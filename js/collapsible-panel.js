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
 */

const _STORAGE_KEY = 'panel-states';

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

/* ===== Private ===== */

function _loadStates() {
    try {
        const raw = localStorage.getItem(_STORAGE_KEY);
        _states = raw ? JSON.parse(raw) : {};
    } catch {
        _states = {};
    }
}

function _saveStates() {
    try {
        localStorage.setItem(_STORAGE_KEY, JSON.stringify(_states));
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
    const body    = panel.querySelector('.cp-body');

    panel.classList.toggle('cp-panel--open', open);
    if (summary) summary.setAttribute('aria-expanded', String(open));
    if (body)    body.hidden = !open;

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
        // Action buttons inside a summary (e.g. btn-clear-pins) must not toggle.
        if (e.target.closest('.summary-action-btn')) return;
        const summary = e.target.closest('.panel-summary[aria-controls]');
        if (!summary) return;
        const panel = summary.closest('.cp-panel');
        if (panel) _toggle(panel);
    });

    sidebar.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('.summary-action-btn')) return;
        if (!e.target.matches('.panel-summary[aria-controls]')) return;
        e.preventDefault();
        const panel = e.target.closest('.cp-panel');
        if (panel) _toggle(panel);
    });
}

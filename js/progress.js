/**
 * progress.js — Progress overlay.
 *
 * Owns the single full-screen progress overlay shown during tile fetches
 * and index loading.  Any module can show or hide it without knowing about
 * the DOM structure or needing a callback injected by app.js.
 *
 * Call order:
 *   1. initProgress()   — once in app.js/_boot(), caches DOM refs.
 *   2. showProgress(msg) / hideProgress()  — from any module at any time.
 */

const _el = {};

/**
 * Cache the overlay DOM references.
 * Must be called once before showProgress() / hideProgress().
 */
export function initProgress() {
    _el.overlay = document.getElementById('progress-overlay');
    _el.msg = document.getElementById('progress-msg');
}

/**
 * Show the progress overlay with an optional status message.
 * @param {string} [msg='']
 */
export function showProgress(msg = '') {
    _el.overlay?.classList.remove('hidden');
    if (_el.msg) _el.msg.textContent = msg;
}

/**
 * Hide the progress overlay.
 */
export function hideProgress() {
    _el.overlay?.classList.add('hidden');
    if (_el.msg) _el.msg.textContent = '';
}

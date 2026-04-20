/**
 * progress.js — Progress overlay.
 *
 * Owns the single full-screen progress overlay shown during tile fetches
 * and index loading.  Any module can show or hide it without knowing about
 * the DOM structure or needing a callback injected by app.js.
 *
 * Call order:
 *   1. initProgress()    — once in app.js/_boot(), caches DOM refs.
 *   2. showProgress(msg) / hideProgress()  — from any module at any time.
 *
 * The overlay is only revealed after SHOW_DELAY_MS (250 ms).
 * Fast operations that complete within this window never show the spinner,
 * eliminating the distracting flash on tile-cache hits.
 */

const SHOW_DELAY_MS = 250;

const _el = {};
let _showTimer = null;  // showProgress
let _flashTimer = null; // showFlash
let _pendingMsg = '';

/**
 * Cache the overlay DOM references.
 * Must be called once before showProgress() / hideProgress().
 */
export function initProgress() {
    _el.overlay = document.getElementById('progress-overlay');
    _el.msg = document.getElementById('progress-msg');
}

/**
 * Schedule the progress overlay to appear after SHOW_DELAY_MS.
 * Subsequent calls before the delay fires update the message without
 * resetting the timer — the overlay still appears at the original time.
 * @param {string} [msg='']
 */
export function showProgress(msg = '') {
    _pendingMsg = msg;
    if (_el.msg) _el.msg.textContent = msg;

    if (!_showTimer) {
        _showTimer = setTimeout(() => {
            _showTimer = null;
            // Update message in case it changed while waiting.
            if (_el.msg) _el.msg.textContent = _pendingMsg;
            _el.overlay?.classList.remove('hidden');
        }, SHOW_DELAY_MS);
    }
}

/**
 * Show a brief message in the progress overlay without the spinner.
 * Auto-hides after the given duration (default 1.5 s).
 * @param {string} msg
 * @param {number} [durationMs=1500]
 */
export function showFlash(msg, durationMs = 1500) {
    _clearTimer();
    if (_flashTimer) clearTimeout(_flashTimer);
    _el.overlay?.classList.add('no-spinner');
    _el.overlay?.classList.remove('hidden');
    if (_el.msg) _el.msg.textContent = msg;
    _flashTimer = setTimeout(() => {
        _el.overlay?.classList.add('hidden');
        _el.overlay?.classList.remove('no-spinner');
        if (_el.msg) _el.msg.textContent = '';
    }, durationMs);
}

/**
 * Cancel any pending show and hide the overlay immediately.
 */
export function hideProgress() {
    _clearTimer();
    _el.overlay?.classList.add('hidden');
    if (_el.msg) _el.msg.textContent = '';
    _pendingMsg = '';
}

function _clearTimer() {
    if (_showTimer) {
        clearTimeout(_showTimer);
        _showTimer = null;
    }
}
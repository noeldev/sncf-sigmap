// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * webshare.js — Web Share API integration.
 *
 * Builds a shareable URL from the given signal parameters and invokes
 * the Web Share API when available, falling back to a clipboard copy
 * with a flash notification.
 *
 * URL format:
 *   <origin><pathname>?networkId=<id>
 *   <origin><pathname>?lineCode=<code>
 *
 * Parameter semantics (handled by map-layer.js handleUrlParams):
 *   networkId  — fly to a specific signal.
 *   lineCode   — fly to the bounding box of a line.
 *
 * Clipboard fallback note:
 *   The fallback copies a plain URL string via navigator.clipboard.writeText.
 *
 * Public API:
 *   canShare()
 *   shareSignal(networkId)
 *   shareLine(lineCode)
 */

import { t } from '../core/translation.js';
import { FIELD } from './field-keys.js';
import { showFlash } from './progress.js';


/**
 * True when the Web Share API is available in the current browser.
 * Evaluated at call time — no module-level caching needed since the
 * capability does not change at runtime.
 * Callers use this to decide whether to show the Share context menu item.
 * @returns {boolean}
 */
export function canShare() {
    return typeof navigator.share === 'function';
}

/**
 * Build a shareable URL with a single FIELD-keyed parameter.
 * Any existing query string is discarded so the result is always clean.
 * Uses FIELD key constants as URL parameter names — stays in sync with
 * field-keys.js automatically; no string duplication.
 *
 * @param {string} fieldKey  FIELD constant value used as the URL parameter name.
 * @param {string} value     Parameter value.
 * @returns {string}
 */
function _buildShareUrl(fieldKey, value) {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set(fieldKey, value);
    return url.toString();
}

/**
 * Core sharing logic: tries Web Share API, falls back to clipboard copy.
 * @param {string} shareUrl   Pre-built shareable URL.
 * @param {string} shareText  Human-readable description for the share dialog.
 */
async function _share(shareUrl, shareText) {
    if (canShare()) {
        try {
            await navigator.share({
                title: t('page.title'),
                text: shareText,
                url: shareUrl,
            });
        } catch (e) {
            // AbortError is thrown when the user dismisses the native share sheet — not an error.
            if (e.name !== 'AbortError') console.warn('[webshare] Share failed:', e.message);
        }
        return;
    }

    // Fallback: copy the URL to the clipboard and show a confirmation flash.
    try {
        await navigator.clipboard.writeText(shareUrl);
        showFlash(t('share.copied'));
    } catch (e) {
        console.warn('[webshare] Clipboard write failed:', e.message);
    }
}

/**
 * Share a signal by its network ID.
 * @param {string} networkId
 */
export async function shareSignal(networkId) {
    await _share(
        _buildShareUrl(FIELD.NETWORK_ID, networkId),
        t('share.signalText', networkId)
    );
}

/**
 * Share a line by its line code.
 * @param {string} lineCode
 */
export async function shareLine(lineCode) {
    await _share(
        _buildShareUrl(FIELD.LINE_CODE, lineCode),
        t('share.lineText', lineCode)
    );
}

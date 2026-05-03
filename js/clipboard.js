/**
 * clipboard.js — Shared clipboard operations for tag-list-based panels.
 *
 * Used by filter-panel.js (FilterPanel) and pins.js to avoid duplicating
 * Copy / Cut / Paste / Delete logic and the MIME type constants.
 *
 * Clipboard payload shape:
 *   { "app": APP_ID, "dataType": "<fieldKey>", "values": [...] }
 *
 *   dataType gates paste compatibility: only payloads whose dataType matches
 *   the target panel's field key are accepted. Two panels with the same
 *   dataType (e.g. a networkId filter and the Pinned Signals panel) can
 *   freely exchange values.
 *
 * Dual-format copy:
 *   text/plain           → comma-separated values (human-readable, external use)
 *   web <MIME_TYPE>      → JSON payload (structured, internal validation)
 *   Falls back to text-only when ClipboardItem is unavailable.
 *
 * Public API:
 *   canPaste(dataType)                        — Promise<boolean>
 *   copyValues(dataType, values)              — Promise<void>, shows flash
 *   readNewValues(dataType, currentValues)    — Promise<string[] | null>
 *   buildTagMenu(anchorBtn, opts)             — async, opens context menu
 *   handleTagsKeydown(e, opts)                — wire keyboard shortcuts
 */

import { APP_ID, CLIPBOARD_MIME_TYPE } from './config.js';
import { t } from './translation.js';
import { showContextMenu } from './context-menu.js';
import { showFlash } from './progress.js';

/** Full custom MIME key used in ClipboardItem (requires 'web ' prefix per Clipboard API spec). */
const CLIPBOARD_WEB_MIME = `web ${CLIPBOARD_MIME_TYPE}`;


// ===== Core clipboard helpers =====

/**
 * Return true when the clipboard contains a valid payload compatible with
 * the given dataType. Returns false on any error (API unavailable, permission
 * denied, non-JSON, wrong app ID or dataType).
 *
 * @param {string} dataType  The field key to match against the payload.
 * @returns {Promise<boolean>}
 */
export async function canPaste(dataType) {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            if (!item.types.includes(CLIPBOARD_WEB_MIME)) continue;
            const blob = await item.getType(CLIPBOARD_WEB_MIME);
            const data = JSON.parse(await blob.text());
            return data?.app === APP_ID
                && data?.dataType === dataType
                && Array.isArray(data?.values);
        }
    } catch { /* permission denied or API unavailable */ }
    return false;
}

/**
 * Write values to the clipboard in two formats and show a confirmation flash.
 *
 * Falls back to text/plain CSV when ClipboardItem is unavailable (e.g. Firefox
 * without the dom.events.asyncClipboard.clipboardItem flag).
 *
 * @param {string}   dataType  The field key stamped into the JSON payload.
 * @param {string[]} values    Values to copy.
 * @returns {Promise<void>}
 */
export async function copyValues(dataType, values) {
    if (!values.length) return;

    const csv = values.join(',');
    const json = JSON.stringify({ app: APP_ID, dataType, values });

    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/plain': new Blob([csv], { type: 'text/plain' }),
                [CLIPBOARD_WEB_MIME]: new Blob([json], { type: CLIPBOARD_MIME_TYPE }),
            }),
        ]);
    } catch {
        // ClipboardItem not supported or permission denied — fall back to CSV.
        try {
            await navigator.clipboard.writeText(csv);
        } catch (err) {
            console.warn('[clipboard] write failed:', err.message);
            return;
        }
    }
    showFlash(t('popup.copied'));
}

/**
 * Read the clipboard and return values that are not already in currentValues.
 * Returns null on any error or when the payload is incompatible.
 *
 * Deduplication happens here so callers receive only genuinely new values
 * and can apply them without risk of toggling off an already-active entry.
 *
 * @param {string}   dataType       The field key to validate against.
 * @param {string[]} currentValues  Values already present; used to skip duplicates.
 * @returns {Promise<string[] | null>}
 */
export async function readNewValues(dataType, currentValues) {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            if (!item.types.includes(CLIPBOARD_WEB_MIME)) continue;
            const blob = await item.getType(CLIPBOARD_WEB_MIME);
            const data = JSON.parse(await blob.text());
            if (data?.app !== APP_ID || data?.dataType !== dataType) return null;
            if (!Array.isArray(data.values)) return null;

            const existing = new Set(currentValues);
            const newVals = data.values.filter(v => !existing.has(v));
            return newVals.length ? newVals : null;
        }
    } catch { /* permission denied or malformed payload */ }
    return null;
}


// ===== Context menu and keyboard =====

/**
 * Build and show the Copy / Cut / Paste / Delete context menu anchored
 * below anchorBtn. Reads the clipboard asynchronously to resolve the Paste
 * enabled state before the menu is shown.
 *
 * @param {HTMLElement} anchorBtn  The button that triggered the menu.
 * @param {object}      opts
 * @param {string}      opts.dataType   Field key for clipboard validation.
 * @param {Function}    opts.getValues  () → string[]  Current tag values.
 * @param {Function}    opts.onDelete   () → void      Delete / clear action.
 * @param {Function}    opts.onPaste    (newValues: string[]) → void
 *   Called with already-deduplicated new values; caller decides how to apply them.
 */
export async function buildTagMenu(anchorBtn, { dataType, getValues, onDelete, onPaste }) {
    const current = getValues();
    const hasValues = current.length > 0;
    const pasteEnabled = await canPaste(dataType);

    const rect = anchorBtn.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 2, [
        {
            labelKey: 'context.copy',
            shortcut: 'Ctrl+C',
            enabled: hasValues,
            action: () => copyValues(dataType, current),
        },
        {
            labelKey: 'context.cut',
            shortcut: 'Ctrl+X',
            enabled: hasValues,
            action: () => { copyValues(dataType, current); onDelete(); },
        },
        {
            labelKey: 'context.paste',
            shortcut: 'Ctrl+V',
            enabled: pasteEnabled,
            action: async () => {
                const newVals = await readNewValues(dataType, getValues());
                if (newVals?.length) onPaste(newVals);
            },
        },
        'separator',
        {
            labelKey: 'context.delete',
            shortcut: 'Del',
            enabled: hasValues,
            action: () => onDelete(),
        },
    ]);
}

/**
 * Handle Ctrl+C / Ctrl+X / Ctrl+V / Delete keyboard shortcuts on a tag
 * container element. Wire this via addEventListener('keydown', ...) on the
 * container so shortcuts are active whenever the tag list has focus.
 *
 * @param {KeyboardEvent} e
 * @param {object}        opts  Same shape as buildTagMenu opts.
 */
export function handleTagsKeydown(e, { dataType, getValues, onDelete, onPaste }) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'c') {
        e.preventDefault();
        copyValues(dataType, getValues());
        return;
    }
    if (ctrl && e.key === 'x') {
        e.preventDefault();
        copyValues(dataType, getValues());
        onDelete();
        return;
    }
    if (ctrl && e.key === 'v') {
        e.preventDefault();
        readNewValues(dataType, getValues()).then(vals => { if (vals?.length) onPaste(vals); });
        return;
    }
    if (e.key === 'Delete' && !ctrl) {
        e.preventDefault();
        onDelete();
    }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * download.js - Browser download helpers shared by the export writers.
 *
 * Used by validate-main.js (GeoJSON) and export-panel.js (MapRoulette) so the
 * Blob/anchor plumbing and the timestamped filename scheme live in one place.
 *
 * Public API:
 *   timestampedName(prefix, ext)        -> "<prefix>_YYYYMMDD_HHMMSSZ.<ext>"
 *   triggerDownload(content, name, mime) -> void
 */

// Strip the "-" and ":" separators from an ISO timestamp for the filename.
const RE_CLEANUP = /[-:]/g;

/**
 * Build a timestamped filename.
 *
 * @param {string} prefix  Leading part of the name.
 * @param {string} ext     Extension without the dot.
 * @returns {string}
 */
export function timestampedName(prefix, ext) {
    const iso = new Date().toISOString(); // Ex: "2026-06-02T14:30:15.123Z"
    const stamp = iso.slice(0, 19).replace('T', '_').replace(RE_CLEANUP, '');
    return `${prefix}_${stamp}Z.${ext}`;
}

/**
 * Trigger a browser download of a string payload.
 *
 * @param {string} content
 * @param {string} filename
 * @param {string} mime
 */
export function triggerDownload(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}

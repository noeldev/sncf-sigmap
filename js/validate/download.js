// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * download.js - Browser download helpers shared by the export writers.
 *
 * Used by validate.js (GeoJSON) and export-panel.js (MapRoulette) so the Blob /
 * anchor plumbing and the timestamp scheme live in one place. timestamp() is
 * exposed separately so a multi-file batch can share a single stamp across every
 * filename.
 *
 * Public API:
 *   timestamp()                          -> "YYYYMMDD_HHMMSSZ"
 *   timestampedName(prefix, ext)         -> "<prefix>_YYYYMMDD_HHMMSSZ.<ext>"
 *   triggerDownload(content, name, mime) -> void
 */

// Strip the "-" and ":" separators from an ISO timestamp for the filename.
const RE_CLEANUP = /[-:]/g;

/**
 * Current UTC timestamp formatted for filenames, e.g. "20260616_143015Z".
 * @returns {string}
 */
export function timestamp() {
    const iso = new Date().toISOString(); // Ex: "2026-06-16T14:30:15.123Z"
    return iso.slice(0, 19).replace('T', '_').replace(RE_CLEANUP, '') + 'Z';
}

/**
 * Build a timestamped filename.
 * @param {string} prefix  Leading part of the name.
 * @param {string} ext     Extension without the dot.
 * @returns {string}
 */
export function timestampedName(prefix, ext) {
    return `${prefix}_${timestamp()}.${ext}`;
}

/**
 * Trigger a browser download of a string payload via a temporary anchor.
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

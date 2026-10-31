// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * export-panel.js - MapRoulette export dialog (native <dialog> modal).
 *
 * The MapRoulette export produces one file per leading line-code digit (0..9)
 * for region-by-region challenges. This dialog lists those ten files in a table
 * so the user can pick a subset and download them - separately, or merged into a
 * single file.
 *
 * Why a native <dialog>:
 *   showModal() gives a centered, backdrop-dimmed, focus-trapped modal with
 *   Escape-to-close for free, and its inert backdrop blocks the export button
 *   underneath, reinforcing the re-entrancy guard in validate.js. The dialog
 *   markup lives in validate.html; rows are cloned from #tpl-mr-file-row. No
 *   HTML strings are built here.
 *
 * Selection:
 *   Every row carries a checkbox and the header checkbox toggles them all (the
 *   list is short - ten files - so there is no text filter). The footer total
 *   follows the current selection (the grand total when all ten are checked - the
 *   parity figure to cross-check against the GeoJSON node count).
 *
 * Download:
 *   The Download button writes the selected files as staggered browser downloads
 *   (one user prompt, then all land in the Downloads folder) and closes the
 *   dialog. When "merge" is ticked (enabled once two or more files are selected),
 *   the selected challenges are instead concatenated into a single NDJSON file -
 *   so ticking every region yields one whole-France challenge on demand. Closing
 *   (button, Escape, backdrop) calls onClose so validate.js re-enables the export
 *   button.
 *
 *   Each challenge file comes with a Markdown file of the same base name holding
 *   the challenge texts (name, description, instruction) to paste in the
 *   MapRoulette form. The texts are versioned in challenge-texts.json and filled
 *   with the line codes and region of the challenge (challenge-text.js).
 *
 *   The changeset comment and source are not handled here: they are entered once
 *   in the MapRoulette challenge form at challenge creation (MapRoulette appends
 *   #maproulette itself), so they belong to neither the dialog nor the .osc.
 *
 * Public API:
 *   openMapRouletteDialog(files, { onClose }) -> void
 */

import { buildChallengeText } from './challenge-text.js';
import { timestamp, triggerDownload } from './download.js';

// ===== Constants =====

const MR_MIME = 'application/geo+json';
const TEXT_MIME = 'text/markdown';
const FILE_PREFIX = 'signals-sncf-maproulette';

// Delay between successive downloads (ms) so the browser does not drop files
// requested in the same tick.
const DOWNLOAD_STAGGER_MS = 300;

// ===== State =====

let _files = [];
let _onClose = null;
let _closeNotified = false;

let _dialog = null;
let _tbody = null;
let _checkAll = null;
let _merge = null;
let _totalTasks = null;
let _totalNodes = null;
let _download = null;

// ===== Init =====

_init();

function _init() {
    _dialog = document.getElementById('mr-dialog');
    if (!_dialog) return;

    _tbody = document.getElementById('mr-tbody');
    _checkAll = document.getElementById('mr-check-all');
    _merge = document.getElementById('mr-merge');
    _totalTasks = document.getElementById('mr-total-tasks');
    _totalNodes = document.getElementById('mr-total-nodes');
    _download = document.getElementById('mr-download');

    document.getElementById('mr-dialog-close')
        .addEventListener('click', () => _dialog.close());

    // Header checkbox toggles every row.
    _checkAll.addEventListener('change', () => {
        for (const cb of _allChecks()) cb.checked = _checkAll.checked;
        _syncControls();
    });

    // Delegated row checkbox changes.
    _tbody.addEventListener('change', (e) => {
        if (e.target.classList.contains('mr-file-check')) _syncControls();
    });

    _download.addEventListener('click', _downloadSelected);

    // Native close (button, Escape, or programmatic): notify the caller once.
    _dialog.addEventListener('close', () => {
        if (_closeNotified) return;
        _closeNotified = true;
        _onClose?.();
    });
}

// ===== Public API =====

/**
 * Populate and open the modal for the given challenge files.
 *
 * @param {Array<{ bucket, region, taskCount, nodeCount, content }>} files
 * @param {{ onClose?: () => void }} [opts]
 */
export function openMapRouletteDialog(files, { onClose } = {}) {
    if (!_dialog) { onClose?.(); return; }
    _files = files;
    _onClose = onClose ?? null;
    _closeNotified = false;
    _render();
    _dialog.showModal();
}

// ===== Rendering =====

function _render() {
    const tpl = document.getElementById('tpl-mr-file-row');
    const frag = document.createDocumentFragment();

    _files.forEach((file, i) => {
        const row = tpl.content.cloneNode(true).firstElementChild;
        row.dataset.index = i;
        row.querySelector('[data-field="label"]').textContent = _label(file);
        row.querySelector('[data-field="region"]').textContent = _region(file);
        row.querySelector('[data-field="tasks"]').textContent = file.taskCount.toLocaleString();
        row.querySelector('[data-field="nodes"]').textContent = file.nodeCount.toLocaleString();
        row.querySelector('.mr-file-check').checked = true;
        frag.appendChild(row);
    });

    _tbody.replaceChildren(frag);
    _syncControls();
}

/** Dialog label for a file: its bucket ("0xxxxx".."9xxxxx"). */
function _label(file) {
    return file.bucket;
}

/** Informal region label (already a plain string; never translated). */
function _region(file) {
    return file.region ?? '';
}

// ===== Selection =====

function _allChecks() {
    return [..._tbody.querySelectorAll('.mr-file-check')];
}

function _selectedFiles() {
    return [..._tbody.querySelectorAll('.mr-file-row')]
        .filter(row => row.querySelector('.mr-file-check').checked)
        .map(row => _files[Number(row.dataset.index)]);
}

function _syncControls() {
    const all = _allChecks();
    const checked = all.filter(cb => cb.checked).length;
    _checkAll.checked = all.length > 0 && checked === all.length;
    _checkAll.indeterminate = checked > 0 && checked < all.length;

    // Totals reflect the current selection (what gets downloaded or merged).
    const selected = _selectedFiles();
    const tasks = selected.reduce((sum, f) => sum + f.taskCount, 0);
    const nodes = selected.reduce((sum, f) => sum + f.nodeCount, 0);
    _totalTasks.textContent = tasks.toLocaleString();
    _totalNodes.textContent = nodes.toLocaleString();

    // Merging only makes sense with two or more challenges.
    _merge.disabled = selected.length < 2;
    if (_merge.disabled) _merge.checked = false;

    _download.disabled = selected.length === 0;
}

// ===== Download =====

async function _downloadSelected() {
    const selected = _selectedFiles();
    if (!selected.length) return;

    _download.disabled = true;

    // Merge: the selection forms one challenge. Otherwise one challenge per file.
    const challenges = (_merge.checked && selected.length >= 2)
        ? [selected]
        : selected.map(file => [file]);

    _scheduleDownloads(await _buildDownloads(challenges, timestamp()));
    _dialog.close();
}

/**
 * Build the downloads of the given challenges: a challenge file, plus its texts
 * file when the texts are available.
 *
 * Each file is a complete RFC 7464 sequence (every line RS-prefixed,
 * LF-terminated), so plain concatenation of merged files stays valid.
 *
 * @param {Array<Array<object>>} challenges  Challenge files grouped per challenge.
 * @param {string} stamp
 * @returns {Promise<Array<{ content: string, name: string, mime: string }>>}
 */
async function _buildDownloads(challenges, stamp) {
    const downloads = [];

    for (const files of challenges) {
        const baseName = _baseName(files, stamp);
        downloads.push({
            content: files.map(file => file.content).join(''),
            name: `${baseName}.geojson`,
            mime: MR_MIME,
        });

        const text = await buildChallengeText(files);
        if (text) downloads.push({ content: text, name: `${baseName}.md`, mime: TEXT_MIME });
    }

    return downloads;
}

/** Staggered so the browser does not drop files requested in the same tick. */
function _scheduleDownloads(downloads) {
    downloads.forEach(({ content, name, mime }, i) => setTimeout(
        () => triggerDownload(content, name, mime),
        i * DOWNLOAD_STAGGER_MS));
}

/** signals-sncf-maproulette_<bucket|merged>_<stamp> (no extension) */
function _baseName(files, stamp) {
    const label = files.length > 1 ? 'merged' : files[0].bucket;
    return `${FILE_PREFIX}_${label}_${stamp}`;
}

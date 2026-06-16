// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * export-panel.js - MapRoulette file list popover.
 *
 * The MapRoulette export produces one file per line-code bucket. This popover
 * lists them so the user can download each file independently (to test bucket
 * by bucket) or all of them at once.
 *
 * "Download all" fires the per-file downloads with a short stagger so the
 * browser does not collapse or drop rapid successive downloads; the browser may
 * still ask once to allow multiple downloads.
 *
 * The popover markup lives in validate.html (anchored inside #export-menu);
 * rows are cloned from the #tpl-mr-file-row template. No HTML strings here.
 *
 * Visibility note: the popover sits inside #export-menu, so the click that opens
 * it (the MapRoulette menu item) is ignored by the outside-click handler.
 *
 * Public API:
 *   showMapRouletteFiles(files) -> void
 *   hideMapRouletteFiles()      -> void
 */

import { t } from '../core/translation.js';
import { triggerDownload, timestampedName } from './download.js';

// ===== Constants =====

const MR_MIME = 'application/geo+json';
const FILE_PREFIX = 'signals-sncf-maproulette';

// Delay between successive downloads in "Download all" (ms). Keeps the browser
// from dropping files when many are requested in the same tick.
const DOWNLOAD_STAGGER_MS = 300;

// ===== State =====

let _files = [];
let _root = null;
let _list = null;
let _summary = null;

// ===== Init =====

_init();

function _init() {
    _root = document.getElementById('mr-files');
    if (!_root) return;

    _list = document.getElementById('mr-files-list');
    _summary = document.getElementById('mr-files-summary');

    document.getElementById('mr-files-close')
        .addEventListener('click', hideMapRouletteFiles);
    document.getElementById('mr-files-all')
        .addEventListener('click', _downloadAll);

    // One delegated handler for every row's Download button.
    _list.addEventListener('click', (e) => {
        const btn = e.target.closest('.mr-file-dl');
        if (!btn) return;
        const idx = Number(btn.closest('.mr-file-row').dataset.index);
        _downloadFile(_files[idx]);
    });

    // Dismiss on a click truly outside both the popover and the export menu,
    // or on Escape. Clicks inside the export menu (e.g. the opening item) are
    // ignored so the popover is not closed on the same click that opened it.
    document.addEventListener('click', (e) => {
        if (_root.hidden) return;
        if (_root.contains(e.target) || _isExportMenu(e.target)) return;
        hideMapRouletteFiles();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideMapRouletteFiles();
    });
}

// ===== Public API =====

/**
 * Populate and reveal the popover for the given challenge files.
 *
 * @param {Array<{ label, content, taskCount, nodeCount }>} files
 */
export function showMapRouletteFiles(files) {
    if (!_root) return;
    _files = files;
    _render();
    _root.hidden = false;
}

/** Hide the popover. */
export function hideMapRouletteFiles() {
    if (_root) _root.hidden = true;
}

// ===== Private =====

function _render() {
    // Close button label/title (set here so strings are already loaded).
    const close = document.getElementById('mr-files-close');
    close.title = t('export.close');
    close.setAttribute('aria-label', t('export.close'));

    const tpl = document.getElementById('tpl-mr-file-row');
    const frag = document.createDocumentFragment();

    let totalTasks = 0;
    let totalNodes = 0;

    _files.forEach((file, i) => {
        totalTasks += file.taskCount;
        totalNodes += file.nodeCount;

        const row = tpl.content.cloneNode(true).firstElementChild;
        row.dataset.index = i;
        row.querySelector('[data-field="label"]').textContent = file.label;
        row.querySelector('[data-field="meta"]').textContent =
            t('export.fileSummary', file.taskCount.toLocaleString(), file.nodeCount.toLocaleString());
        row.querySelector('.mr-file-dl').textContent = t('export.download');
        frag.appendChild(row);
    });

    _list.replaceChildren(frag);
    _summary.textContent = t('export.totalSummary',
        _files.length.toLocaleString(),
        totalTasks.toLocaleString(),
        totalNodes.toLocaleString());
}

function _downloadFile(file) {
    if (!file) return;
    triggerDownload(
        file.content,
        timestampedName(`${FILE_PREFIX}_${file.label}`, 'geojson'),
        MR_MIME
    );
}

function _downloadAll() {
    _files.forEach((file, i) => {
        setTimeout(() => _downloadFile(file), i * DOWNLOAD_STAGGER_MS);
    });
}

function _isExportMenu(target) {
    const menu = document.getElementById('export-menu');
    return !!menu && menu.contains(target);
}

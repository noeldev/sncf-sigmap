// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * build-info.js - Build line of the deployed site ("Built ... from commit ...").
 *
 * The date and commit come from build-info.local.js (git-ignored), generated
 * by the Netlify build (see netlify.toml). On a local server the file is
 * absent and no build line is shown.
 *
 * Public API:
 *   loadBuildInfo()                     - { date, commit } of the build, or null
 *   renderBuildInfo(el, template, info) - fill and show an element with the line
 */

import { REPO_URL } from './config.js';

const RE_COMMIT = /^[0-9a-f]{7,40}$/;

// {0} is replaced by the date, {1} by the commit link.
const RE_SLOT = /(\{[01]\})/;

// Same length as the build line of noeld.com.
const SHORT_COMMIT_LENGTH = 12;

let _info = null;

/**
 * Load the build information once.
 * @returns {Promise<{date: Date, commit: string}|null>}
 */
export function loadBuildInfo() {
    _info ??= import('./build-info.local.js')
        .then(({ BUILD_DATE, BUILD_COMMIT }) => _validate(BUILD_DATE, BUILD_COMMIT))
        .catch(() => null);
    return _info;
}

/**
 * Fill an element with the build line and show it.
 * @param {HTMLElement} el
 * @param {string} template  Text where {0} is the date and {1} the commit,
 *                           e.g. "Built {0} from commit {1}."
 * @param {{date: Date, commit: string}} info
 */
export function renderBuildInfo(el, template, info) {
    const slots = { '{0}': _dateNode(info.date), '{1}': _commitNode(info.commit) };
    el.replaceChildren(...template.split(RE_SLOT).filter(Boolean)
        .map(part => slots[part] ?? document.createTextNode(part)));
    el.hidden = false;
}

function _validate(dateText, commit) {
    const date = new Date(dateText);
    return !Number.isNaN(date.getTime()) && RE_COMMIT.test(commit ?? '') ? { date, commit } : null;
}

// "2026-11-10 20:15 UTC", whatever the language.
function _dateNode(date) {
    const iso = date.toISOString();
    const time = document.createElement('time');
    time.dateTime = iso;
    time.textContent = `${iso.slice(0, 16).replace('T', ' ')} UTC`;
    return time;
}

function _commitNode(commit) {
    const link = document.createElement('a');
    link.href = `${REPO_URL}/commit/${commit}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = commit.slice(0, SHORT_COMMIT_LENGTH);
    return link;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * challenge-text.js - MapRoulette challenge texts (name, description, instruction).
 *
 * A MapRoulette challenge file (line-by-line GeoJSON) cannot carry the texts of
 * the challenge: they are typed in the challenge form. To keep them versioned
 * with the code, they live in challenge-texts.json (next to this module) and are
 * exported as a Markdown file next to each challenge file, ready to paste.
 *
 * Template variables (single braces, so they never clash with the double-brace
 * placeholders of MapRoulette such as {{idreseau}} and {{code_voie}}, which are
 * left untouched):
 *   {lineCodes} - leading line-code buckets of the challenge, e.g. "4xxxxx"
 *   {region}    - informal region label(s) of those buckets, e.g. "Ouest"
 * For a merged challenge the buckets are comma-joined and the regions are
 * de-duplicated (buckets 3 and 4 both give "Ouest").
 *
 * challenge-texts.json format, same as the MapRouletteGen settings of the
 * FrenchRailwaySignalling repository: one string per text, "\n" for line breaks.
 *   { "name": "...", "description": "...", "instruction": "..." }
 *
 * The Markdown uses CRLF line endings. When the texts file is missing or invalid
 * the export carries on without Markdown (a warning is logged).
 *
 * Public API:
 *   buildChallengeText(files)           -> Promise<string|null>
 *   renderChallengeText(texts, files)   -> string   (pure, no I/O)
 *
 *   files = Array<{ bucket, region, taskCount, nodeCount }>  (challenge files
 *   of one challenge: a single file, or the selection merged into one).
 */

// ===== Constants =====

const TEXTS_URL = new URL('challenge-texts.json', import.meta.url);

const REQUIRED_FIELDS = ['name', 'description', 'instruction'];

// Separator for the bucket and region lists of a merged challenge.
const LIST_SEPARATOR = ', ';

// ===== State =====

// The texts file is read once, on first use.
let _textsPromise = null;

// ===== Public API =====

/**
 * Build the Markdown texts of a challenge made of the given files.
 *
 * @param {Array<{ bucket: string, region: string, taskCount: number, nodeCount: number }>} files
 * @returns {Promise<string|null>}  Markdown (CRLF), or null when the texts are unavailable.
 */
export async function buildChallengeText(files) {
    _textsPromise ??= _fetchTexts();
    const texts = await _textsPromise;
    return texts ? renderChallengeText(texts, files) : null;
}

/**
 * Fill the template variables and lay the texts out as Markdown.
 *
 * @param {{ name: string, description: string, instruction: string }} texts
 * @param {Array<{ bucket: string, region: string, taskCount: number, nodeCount: number }>} files
 * @returns {string}  Markdown (CRLF).
 */
export function renderChallengeText(texts, files) {
    const variables = {
        '{lineCodes}': _unique(files.map(file => file.bucket)).join(LIST_SEPARATOR),
        '{region}': _unique(files.map(file => file.region)).join(LIST_SEPARATOR),
    };
    const fill = text => Object.entries(variables)
        .reduce((result, [token, value]) => result.replaceAll(token, value), text);

    const tasks = files.reduce((sum, file) => sum + file.taskCount, 0);
    const nodes = files.reduce((sum, file) => sum + file.nodeCount, 0);

    return [
        `# ${fill(texts.name)}`,
        '',
        '## Description',
        '',
        fill(texts.description),
        '',
        '## Instruction',
        '',
        fill(texts.instruction),
        '',
        '## Statistics',
        '',
        `- Tasks: ${tasks}`,
        `- Nodes: ${nodes}`,
        '',
    ].join('\n').replace(/\r?\n/g, '\r\n');
}

// ===== Helpers =====

/** Distinct non-empty values, in first-seen order. */
function _unique(values) {
    return [...new Set(values.filter(Boolean))];
}

/** Read and check challenge-texts.json; null (with a warning) when unusable. */
async function _fetchTexts() {
    try {
        const res = await fetch(TEXTS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const texts = await res.json();
        const missing = REQUIRED_FIELDS.filter(field => typeof texts[field] !== 'string');
        if (missing.length) throw new Error(`missing text field(s): ${missing.join(', ')}`);
        return texts;
    } catch (err) {
        console.warn('[challenge-text] challenge-texts.json unusable; challenge texts are not exported.', err);
        return null;
    }
}

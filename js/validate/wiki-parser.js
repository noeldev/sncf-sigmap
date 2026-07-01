// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * wiki-parser.js - Fetch and parse the OpenRailwayMap/Tagging_in_France wiki page.
 *
 * Downloads the raw MediaWiki *wikitext* (not the rendered HTML) via the parse
 * API (prop=wikitext, CORS-enabled via origin=*), or reads it from a local file
 * when a source is given (local-server testing), then extracts signal
 * definitions from the {{Tag}} / {{TagValue}} templates.
 *
 * Every value is captured as-is (FR:, bare values like "light"/"forward",
 * etc.); which namespaces to compare (e.g. excluding ETCS:) is a comparison
 * policy applied in spec-compare.js, not here.
 *
 * Why wikitext rather than rendered HTML:
 *   - The template grammar is stable; rendered HTML (wbr, spans, entities) is
 *     not, and required DOMParser plus textContent workarounds.
 *   - {{TagValue}} renders as the value alone (no "key=value"), so an HTML scan
 *     silently drops every enumerated value. The wikitext carries the key.
 *
 * Two distinct things are extracted, because the wiki documents them
 * differently:
 *
 *   keys  - every documented key (cat), from any {{Tag|railway:signal:<cat>...}},
 *           even when the value is left empty. This is presence: the wiki says
 *           the key exists. Example: {{Tag|railway:signal:main:states|}} declares
 *           the key but enumerates no value (it links to a sub-page instead).
 *
 *   pairs - enumerated (cat, FR:value) values only. A value counts as enumerated
 *           when it is given as the value of a single-value {{Tag|...|FR:x}} or
 *           listed inside an enumeration block {{Tag|...||( {{TagValue}} / ... )}}.
 *           A bare {{TagValue}} sitting in prose (e.g. "...displaying the FR:C
 *           state...") is NOT an enumeration and is ignored: it would otherwise
 *           inject phantom values for keys the wiki never enumerated.
 *
 * Enumeration blocks {{Tag|...||( ... )}} may span several lines (the "(" can
 * sit on the line after "||"), so blocks are matched across newlines rather
 * than per line; a {{TagValue}} counts as enumerated only when it lies inside
 * such a block. The closing ")}}" is the first one after the opener, which is
 * unambiguous here because enumerated FR: values never contain ")".
 *
 * States sub-pages:
 *   The main page links to dedicated Key: sub-pages for signal states
 *   (e.g. FR:Key:railway:signal:main:states) rather than enumerating values
 *   inline. Those sub-pages use standalone {{TagValue|railway:signal:<cat>|FR:x}}
 *   entries directly in wiki table cells -- not inside {{Tag|...||( ... )}} enum
 *   blocks. The main-page rule (TagValue only inside blocks) would silently drop
 *   every state value, so sub-pages are parsed with standaloneTagValues = true,
 *   which applies RE_TAGVALUE unconditionally. The shared _seen set prevents
 *   duplication if both passes happen to match the same pair.
 *
 * No category filtering is applied: pairs is the complete enumerated set. Each
 * comparison applies its own scope (see spec-compare.js).
 *
 * Public API:
 *   fetchWikiSpec(source?)  -> Promise<WikiSpec | null>
 *
 * WikiSpec:
 *   pairs:  Array<{ cat: string, type: string }>   enumerated values
 *   byCat:  Map<string, Set<string>>               enumerated values per cat
 *   keys:   Set<string>                            every documented cat (presence)
 */

// Main tagging page title (MediaWiki API page parameter).
const MAIN_PAGE = 'OpenRailwayMap/Tagging_in_France';

// Sub-pages that enumerate values not listed inline on the main page.
// Fetched in parallel; failures are non-fatal (spec is partial but functional).
const STATES_SUBPAGES = [
    'FR:Key:railway:signal:main:states',
    'FR:Key:railway:signal:distant:states',
];

// Every documented key: {{Tag|railway:signal:<cat>...}} up to the first "|" or "}".
const RE_KEY = /\{\{Tag\|railway:signal:([^|}]+)[|}]/g;
// Single-value tag: {{Tag|railway:signal:<cat>|<value>}} (one value, not "||").
const RE_TAG_VALUE = /\{\{Tag\|railway:signal:([^|}]+)\|([^|}]+)\}\}/g;
// Enumeration block: {{Tag|railway:signal:<cat>||( ... )}}; the "(" may follow a
// newline. Group 1 is the list body, scanned for its {{TagValue}} entries.
const RE_ENUM_BLOCK = /\{\{Tag\|railway:signal:[^|}]+\|\|\s*\(([\s\S]*?)\)\}\}/g;
// Tag value reference: {{TagValue|railway:signal:<cat>|<value>}}.
// On the main page, only matched inside RE_ENUM_BLOCK (prose mentions are ignored).
// On Key: sub-pages, matched unconditionally (all occurrences are table enumerations).
const RE_TAGVALUE = /\{\{TagValue\|railway:signal:([^|}]+)\|([^|}]+)\}\}/g;

// ===== sessionStorage cache =====
// The wiki page changes rarely; cache the parsed result for 1 hour to avoid
// a network round-trip on every page reload.

// DevTools > Application > Storage > Session Storage > https://localhost:8443
const CACHE_KEY = 'sncf-sigmap:wiki-spec';
const CACHE_TTL = 3_600_000; // 1 hour in ms

function _loadCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL) {
            sessionStorage.removeItem(CACHE_KEY);
            return null;
        }
        return {
            pairs: data.pairs,
            byCat: new Map(data.byCat.map(([k, v]) => [k, new Set(v)])),
            keys: new Set(data.keys),
        };
    } catch {
        return null;
    }
}

function _saveCache(spec) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            data: {
                pairs: spec.pairs,
                byCat: [...spec.byCat.entries()].map(([k, v]) => [k, [...v]]),
                keys: [...spec.keys],
            },
        }));
    } catch {
        // sessionStorage may be unavailable (private browsing, quota exceeded).
    }
}

// ===== Public API =====

/**
 * Build the WikiSpec from the wiki page and its states sub-pages.
 *
 * @param {string} [source]  Optional URL or local path to a raw wikitext file.
 *                           When given (local-server testing), it is fetched
 *                           directly and the API/cache are bypassed so edits
 *                           are picked up. When omitted, the MediaWiki API is
 *                           used and the result is cached.
 * @returns {Promise<WikiSpec | null>}
 */
export async function fetchWikiSpec(source) {
    if (!source) {
        const cached = _loadCache();
        if (cached) return cached;
    }

    let mainText, subTexts;
    if (source) {
        // Local testing: single provided file, no sub-page fetch.
        mainText = await _fetchText(source);
        if (mainText === null) return null;
        subTexts = [];
    } else {
        // Production: fetch main page and states sub-pages in parallel.
        // Sub-page failures are non-fatal: the spec is partial but functional.
        const results = await Promise.all([
            _fetchPageWikitext(MAIN_PAGE),
            ...STATES_SUBPAGES.map(p => _fetchPageWikitext(p)),
        ]);
        [mainText, ...subTexts] = results;
        if (mainText === null) return null;
    }

    // Parse main page with enum-block-only TagValue rule (ignores prose mentions).
    const acc = _parseInto(mainText, false);
    // Parse sub-pages with standalone TagValue rule (all table entries are enumerations).
    // The shared accumulator deduplicates pairs across all passes.
    for (const sub of subTexts.filter(Boolean)) {
        _parseInto(sub, true, acc);
    }

    const spec = _toSpec(acc);
    if (!source) _saveCache(spec);
    return spec;
}

// ===== Private =====

function _wikiApiUrl(page) {
    return 'https://wiki.openstreetmap.org/w/api.php'
        + '?action=parse'
        + '&page=' + encodeURIComponent(page)
        + '&prop=wikitext'
        + '&format=json'
        + '&origin=*';
}

/** Fetch a raw wikitext file (local path or URL). */
async function _fetchText(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
        return await res.text();
    } catch (err) {
        console.error('[wiki-parser] file fetch failed:', err.message);
        return null;
    }
}

/** Fetch wikitext for a named page through the MediaWiki parse API. */
async function _fetchPageWikitext(page) {
    try {
        const res = await fetch(_wikiApiUrl(page));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const wikitext = json?.parse?.wikitext?.['*'];
        if (typeof wikitext !== 'string' || !wikitext.length) {
            throw new Error('Unexpected API response shape');
        }
        return wikitext;
    } catch (err) {
        console.warn(`[wiki-parser] page "${page}" fetch failed:`, err.message);
        return null;
    }
}

/**
 * Parse wikitext into an accumulator.
 *
 * @param {string}  wikitext
 * @param {boolean} standaloneTagValues
 *   false (main page): {{TagValue}} is only captured inside {{Tag|...||( ... )}}
 *   enumeration blocks. Bare mentions in prose are intentionally ignored.
 *   true (Key: sub-pages): {{TagValue}} is captured unconditionally. Every
 *   occurrence is a table enumeration; there is no prose usage on these pages.
 * @param {object} [acc]  Accumulator from a prior call to chain into. When
 *   omitted a fresh one is created. The _seen set is shared across all chained
 *   calls so duplicates are eliminated regardless of parse order.
 * @returns {object}  The accumulator (same reference as acc when provided).
 */
function _parseInto(wikitext, standaloneTagValues, acc = null) {
    if (!acc) {
        acc = { pairs: [], byCat: new Map(), keys: new Set(), _seen: new Set() };
    }

    const { pairs, byCat, keys, _seen } = acc;

    const addValue = (cat, type) => {
        cat = cat.trim();
        type = type.trim();
        const pairKey = `${cat}|${type}`;
        if (_seen.has(pairKey)) return;
        _seen.add(pairKey);
        pairs.push({ cat, type });
        if (!byCat.has(cat)) byCat.set(cat, new Set());
        byCat.get(cat).add(type);
    };

    for (const m of wikitext.matchAll(RE_KEY)) keys.add(m[1].trim());
    for (const m of wikitext.matchAll(RE_TAG_VALUE)) addValue(m[1], m[2]);

    if (standaloneTagValues) {
        // Key: sub-pages: capture all {{TagValue}} entries directly.
        for (const m of wikitext.matchAll(RE_TAGVALUE)) addValue(m[1], m[2]);
    } else {
        // Main page: only capture {{TagValue}} inside explicit enumeration blocks.
        for (const block of wikitext.matchAll(RE_ENUM_BLOCK)) {
            for (const v of block[1].matchAll(RE_TAGVALUE)) addValue(v[1], v[2]);
        }
    }

    return acc;
}

/**
 * Extract the public WikiSpec from an accumulator, discarding the internal
 * deduplication state (_seen). The returned object is safe to cache and expose.
 *
 * @param {object} acc
 * @returns {WikiSpec}
 */
function _toSpec(acc) {
    return { pairs: acc.pairs, byCat: acc.byCat, keys: acc.keys };
}

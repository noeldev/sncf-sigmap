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

const WIKI_API_URL =
    'https://wiki.openstreetmap.org/w/api.php'
    + '?action=parse'
    + '&page=OpenRailwayMap%2FTagging_in_France'
    + '&prop=wikitext'
    + '&format=json'
    + '&origin=*';

// Every documented key: {{Tag|railway:signal:<cat>...}} up to the first "|" or "}".
const RE_KEY = /\{\{Tag\|railway:signal:([^|}]+)[|}]/g;
// Single-value tag: {{Tag|railway:signal:<cat>|<value>}} (one value, not "||").
const RE_TAG_VALUE = /\{\{Tag\|railway:signal:([^|}]+)\|([^|}]+)\}\}/g;
// Enumeration block: {{Tag|railway:signal:<cat>||( ... )}}; the "(" may follow a
// newline. Group 1 is the list body, scanned for its {{TagValue}} entries.
const RE_ENUM_BLOCK = /\{\{Tag\|railway:signal:[^|}]+\|\|\s*\(([\s\S]*?)\)\}\}/g;
// Enumerated value reference inside a block: {{TagValue|railway:signal:<cat>|<value>}}.
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
 * Build the WikiSpec from the wiki page.
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

    const wikitext = source ? await _fetchText(source) : await _fetchApi();
    if (wikitext === null) return null;

    const spec = _parse(wikitext);
    if (!source) _saveCache(spec);
    return spec;
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

/** Fetch the rendered wikitext through the MediaWiki parse API. */
async function _fetchApi() {
    try {
        const res = await fetch(WIKI_API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const wikitext = json?.parse?.wikitext?.['*'];
        if (typeof wikitext !== 'string' || !wikitext.length) {
            throw new Error('Unexpected API response shape');
        }
        return wikitext;
    } catch (err) {
        console.error('[wiki-parser] API fetch failed:', err.message);
        return null;
    }
}

function _parse(wikitext) {
    const pairs = [];
    const byCat = new Map();
    const keys = new Set();
    const seen = new Set();

    const addValue = (cat, type) => {
        cat = cat.trim();
        type = type.trim();
        const pairKey = `${cat}|${type}`;
        if (seen.has(pairKey)) return;
        seen.add(pairKey);
        pairs.push({ cat, type });
        if (!byCat.has(cat)) byCat.set(cat, new Set());
        byCat.get(cat).add(type);
    };

    // Documented keys (presence), including keys with no enumerated value.
    for (const m of wikitext.matchAll(RE_KEY)) keys.add(m[1].trim());

    // Single-value tags are enumerated values on their own.
    for (const m of wikitext.matchAll(RE_TAG_VALUE)) addValue(m[1], m[2]);

    // Enumeration blocks: take the {{TagValue}} entries listed inside. Prose
    // {{TagValue}} mentions outside any block are intentionally ignored.
    for (const block of wikitext.matchAll(RE_ENUM_BLOCK)) {
        for (const v of block[1].matchAll(RE_TAGVALUE)) addValue(v[1], v[2]);
    }

    return { pairs, byCat, keys };
}

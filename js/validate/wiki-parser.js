// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * wiki-parser.js - Fetch and parse the OpenRailwayMap/Tagging_in_France wiki page.
 *
 * Uses the MediaWiki REST API (CORS-enabled via origin=*) to download the
 * rendered HTML of the wiki page, then extracts all signal type definitions
 * matching the pattern:
 *   railway:signal:<cat>=<FR:type>
 *
 * Uses DOMParser on each <li> textContent to avoid regex truncation caused
 * by <wbr> and inline HTML inside identifiers like FR:TIV-D_MOB or
 * speed_limit_distant. textContent strips tags and decodes entities, giving
 * clean plain text per bullet before the regex runs.
 *
 * Filtering rules applied to regex matches on plain text:
 *   1. Value must start with "FR:".
 *   2. Value must not contain ";" (excludes states=FR:C;FR:VL multi-value lists).
 *   3. Last segment of the key after "railway:signal:" must not be a known
 *      property sub-key that only takes non-FR: values.
 *      "condition" is intentionally NOT in this list: the wiki defines
 *      railway:signal:speed_limit_distant:condition=FR:L, so
 *      "speed_limit_distant:condition" is a valid category.
 *
 * Public API:
 *   fetchWikiSpec()  -> Promise<WikiSpec | null>
 *
 * WikiSpec:
 *   pairs:   Array<{ cat: string, type: string }>
 *   byCat:   Map<string, Set<string>>
 *   byType:  Map<string, Set<string>>
 */

const WIKI_API_URL =
    'https://wiki.openstreetmap.org/w/api.php'
    + '?action=parse'
    + '&page=OpenRailwayMap%2FTagging_in_France'
    + '&prop=text'
    + '&format=json'
    + '&origin=*';

// Sub-key suffixes that carry only non-FR: values and must be excluded.
// "condition" is absent because speed_limit_distant:condition=FR:L is valid.
const PROPERTY_SUFFIXES = new Set([
    'form', 'states', 'shape', 'plate', 'caption',
    'function', 'type', 'height', 'clearing_light', 'short_route',
    'speed', 'arrangement', 'for', 'carriages', 'voltage',
    'frequency', 'automatic', 'deactivated', 'ref',
]);

const RE_TAG = /railway:signal:([^\s=;]+)=(FR:[^\s;]+)/g;

// ===== sessionStorage cache =====
// The wiki page changes rarely; cache the parsed result for 1 hour to avoid
// a network round-trip on every page reload.

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
            byType: new Map(data.byType.map(([k, v]) => [k, new Set(v)])),
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
                byType: [...spec.byType.entries()].map(([k, v]) => [k, [...v]]),
            },
        }));
    } catch {
        // sessionStorage may be unavailable (private browsing, quota exceeded).
    }
}

// ===== Public API =====

export async function fetchWikiSpec() {
    const cached = _loadCache();
    if (cached) return cached;

    const html = await _fetchRenderedHtml();
    if (html === null) return null;
    const spec = _parse(html);
    _saveCache(spec);
    return spec;
}

async function _fetchRenderedHtml() {
    try {
        const res = await fetch(WIKI_API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const html = json?.parse?.text?.['*'];
        if (typeof html !== 'string' || !html.length) {
            throw new Error('Unexpected API response shape');
        }
        return html;
    } catch (err) {
        console.error('[wiki-parser] fetch failed:', err.message);
        return null;
    }
}

function _parse(html) {
    const pairs = [];
    const byCat = new Map();
    const byType = new Map();
    const seen = new Set();

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = doc.querySelectorAll('li');

    for (const li of items) {
        const text = li.textContent;
        RE_TAG.lastIndex = 0;
        let match;
        while ((match = RE_TAG.exec(text)) !== null) {
            const cat = match[1];
            const type = match[2];

            const lastSegment = cat.split(':').pop();
            if (PROPERTY_SUFFIXES.has(lastSegment)) continue;

            const pairKey = `${cat}|${type}`;
            if (seen.has(pairKey)) continue;
            seen.add(pairKey);

            pairs.push({ cat, type });

            if (!byCat.has(cat)) byCat.set(cat, new Set());
            if (!byType.has(type)) byType.set(type, new Set());
            byCat.get(cat).add(type);
            byType.get(type).add(cat);
        }
    }

    return { pairs, byCat, byType };
}

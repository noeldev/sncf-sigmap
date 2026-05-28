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

export async function fetchWikiSpec() {
    const html = await _fetchRenderedHtml();
    if (html === null) return null;
    return _parse(html);
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

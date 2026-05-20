/**
 * wiki-parser.js — Fetch and parse the OpenRailwayMap/Tagging_in_France wiki page.
 *
 * Uses the MediaWiki REST API (CORS-enabled via origin=*) to download the
 * rendered HTML of the wiki page, then extracts all signal type definitions
 * matching the pattern:
 *   railway:signal:<cat>=<FR:type>
 *
 * Filtering rules applied to raw regex matches:
 *   1. Value must start with 'FR:' (excludes form=light, speed=60, etc.)
 *   2. Value must not contain ';' (excludes states=FR:C;FR:VL multi-value lists)
 *   3. Last segment of the key after 'railway:signal:' must not be a known
 *      property sub-key (excludes plate=FR:BM, marker=... when used as property).
 *
 * Public API:
 *   fetchWikiSpec()  → Promise<WikiSpec | null>
 *
 * WikiSpec:
 *   pairs:   Array<{ cat: string, type: string }>   — ordered as found in page
 *   byCat:   Map<string, Set<string>>               — cat  → Set of types
 *   byType:  Map<string, Set<string>>               — type → Set of cats
 */

const WIKI_API_URL =
    'https://wiki.openstreetmap.org/w/api.php'
    + '?action=parse'
    + '&page=OpenRailwayMap%2FTagging_in_France'
    + '&prop=text'
    + '&format=json'
    + '&origin=*';

/**
 * Property sub-key names that appear as suffixes in OSM tag keys but do NOT
 * represent signal categories. Used to filter out property-value tags from
 * type-definition tags.
 *
 * Examples:
 *   railway:signal:main:form=light        → 'form'  is a property  → excluded
 *   railway:signal:speed_limit:marker=*   → 'marker' is a cat part → kept
 *   railway:signal:main:plate=FR:BM       → 'plate' is a property  → excluded
 */
const PROPERTY_SUFFIXES = new Set([
    'form', 'states', 'shape', 'plate', 'caption', 'condition',
    'function', 'type', 'height', 'clearing_light', 'short_route',
    'speed', 'arrangement', 'for', 'carriages', 'voltage',
    'frequency', 'automatic', 'deactivated', 'ref',
]);

/**
 * Matches railway:signal:<cat>=<FR:type> in rendered HTML.
 * The character class [^=\s<&"] stops at HTML tag boundaries and entity starts.
 * Semicolons excluded from type capture to reject multi-value states lists.
 */
const RE_TAG = /railway:signal:([^=\s<&"]+)=(FR:[^<\s;&"]+)/g;

// ===== Public API =====

/**
 * Fetch the wiki page and extract all {cat, type} signal definitions.
 * Returns null on network failure or unexpected API response shape.
 *
 * @returns {Promise<WikiSpec | null>}
 */
export async function fetchWikiSpec() {
    const rawHtml = await _fetchRenderedHtml();
    if (rawHtml === null) return null;

    return _parse(rawHtml);
}

// ===== Private helpers =====

/**
 * Call the MediaWiki API and return the rendered HTML string.
 * Returns null on any error.
 *
 * @returns {Promise<string | null>}
 */
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

/**
 * Extract {cat, type} pairs from rendered HTML.
 *
 * @param {string} html
 * @returns {WikiSpec}
 */
function _parse(html) {
    const pairs  = [];
    const byCat  = new Map();
    const byType = new Map();
    const seen   = new Set();

    RE_TAG.lastIndex = 0;
    let match;
    while ((match = RE_TAG.exec(html)) !== null) {
        const cat  = _decode(match[1]);
        const type = _decode(match[2]);

        // Exclude property-value tags (last key segment is a known property name).
        const lastSegment = cat.split(':').pop();
        if (PROPERTY_SUFFIXES.has(lastSegment)) continue;

        // Deduplicate: same cat+type pair can appear multiple times in the page.
        const pairKey = `${cat}|${type}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        pairs.push({ cat, type });

        if (!byCat.has(cat))   byCat.set(cat,  new Set());
        if (!byType.has(type)) byType.set(type, new Set());
        byCat.get(cat).add(type);
        byType.get(type).add(cat);
    }

    return { pairs, byCat, byType };
}

/** Decode HTML character entities in extracted attribute text. */
function _decode(str) {
    return str
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'");
}

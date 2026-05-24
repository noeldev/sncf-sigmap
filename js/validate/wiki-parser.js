/**
 * wiki-parser.js - Fetch and parse the OpenRailwayMap/Tagging_in_France wiki page.
 *
 * Uses the MediaWiki REST API (CORS-enabled via origin=*) to download the
 * rendered HTML of the wiki page, then extracts all signal type definitions
 * matching the pattern:
 *   railway:signal:<cat>=<FR:type>
 *
 * --- Why DOMParser instead of raw regex on the HTML string ---
 *
 * The MediaWiki HTML renderer inserts inline formatting inside identifiers:
 *   - <wbr> (word-break hints) inside long tag keys like speed_limit_distant
 *   - <a> links wrapping the key or value
 *   - HTML entities (&amp;, &#61;, etc.)
 *
 * Applying a regex directly to the raw HTML string causes truncation at any
 * embedded tag, turning "FR:TIV-D_MOB" into "FR:TIV-D" and making
 * "speed_limit_distant" invisible to the pattern entirely.
 *
 * The fix: parse the HTML with DOMParser, extract text content from each
 * <li> element, and apply the regex to clean plain text. textContent:
 *   - strips all inline HTML tags
 *   - decodes all HTML entities automatically
 *   - preserves the full identifier string without truncation
 *
 * Filtering rules applied to regex matches on plain text:
 *   1. Value must start with "FR:".
 *   2. Value must not contain ";" (excludes states=FR:C;FR:VL multi-value lists).
 *   3. Last segment of the key after "railway:signal:" must not be a known
 *      property sub-key (excludes form=, speed=, plate=, etc.).
 *
 * Public API:
 *   fetchWikiSpec()  -> Promise<WikiSpec | null>
 *
 * WikiSpec:
 *   pairs:   Array<{ cat: string, type: string }>   - ordered as found in page
 *   byCat:   Map<string, Set<string>>               - cat  -> Set of types
 *   byType:  Map<string, Set<string>>               - type -> Set of cats
 */

const WIKI_API_URL =
    'https://wiki.openstreetmap.org/w/api.php'
    + '?action=parse'
    + '&page=OpenRailwayMap%2FTagging_in_France'
    + '&prop=text'
    + '&format=json'
    + '&origin=*';

/**
 * Property sub-key suffixes that appear after the category in OSM tag keys but
 * do NOT represent signal categories. Used to filter out property-value lines.
 *
 * Examples filtered out:
 *   railway:signal:main:form=light       -> last segment "form"   -> excluded
 *   railway:signal:electricity:type=*    -> last segment "type"   -> excluded
 *   railway:signal:main:plate=FR:BM      -> last segment "plate"  -> excluded
 *
 * Examples kept:
 *   railway:signal:speed_limit:marker=FR:Km  -> last segment "marker" -> kept
 *   railway:signal:speed_limit_distant:fast=FR:TIV-D_B -> "fast" -> kept
 */
const PROPERTY_SUFFIXES = new Set([
    'form', 'states', 'shape', 'plate', 'caption', 'condition',
    'function', 'type', 'height', 'clearing_light', 'short_route',
    'speed', 'arrangement', 'for', 'carriages', 'voltage',
    'frequency', 'automatic', 'deactivated', 'ref',
]);

/**
 * Matches railway:signal:<cat>=<FR:type> in plain text (after HTML is stripped).
 * Both cat and type are matched greedily up to whitespace or ";" only --
 * no need to exclude "<" or "&" since DOMParser has already removed markup
 * and decoded entities before this regex runs.
 */
const RE_TAG = /railway:signal:([^\s=;]+)=(FR:[^\s;]+)/g;

// ===== Public API =====

/**
 * Fetch the wiki page and extract all {cat, type} signal definitions.
 * Returns null on network failure or unexpected API response shape.
 *
 * @returns {Promise<WikiSpec | null>}
 */
export async function fetchWikiSpec() {
    const html = await _fetchRenderedHtml();
    if (html === null) return null;
    return _parse(html);
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
 * Parse rendered HTML and extract {cat, type} pairs.
 *
 * Strategy: use DOMParser to build a real DOM, then collect the textContent
 * of every <li> element in the page body. textContent strips all inline tags
 * and decodes HTML entities, giving clean plain text for each bullet point.
 * The regex then runs on this clean text without any risk of tag truncation.
 *
 * Scanning <li> elements only (rather than the full body text) avoids false
 * positives from prose descriptions that happen to mention tag names inline.
 *
 * @param {string} html - Raw HTML from the MediaWiki API.
 * @returns {WikiSpec}
 */
function _parse(html) {
    const pairs = [];
    const byCat = new Map();
    const byType = new Map();
    const seen = new Set();

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = doc.querySelectorAll('li');

    for (const li of items) {
        // textContent gives fully decoded, tag-free plain text for this bullet.
        const text = li.textContent;

        RE_TAG.lastIndex = 0;
        let match;
        while ((match = RE_TAG.exec(text)) !== null) {
            const cat = match[1];
            const type = match[2];

            // Filter out property-value sub-keys.
            const lastSegment = cat.split(':').pop();
            if (PROPERTY_SUFFIXES.has(lastSegment)) continue;

            // Deduplicate: same cat+type pair may appear in multiple bullets.
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

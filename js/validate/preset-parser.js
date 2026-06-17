// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * preset-parser.js - Parse a JOSM preset XML and extract (cat, type) pairs.
 *
 * Produces every (cat, type) pair the preset can emit, where the key starts
 * with "railway:signal:" (cat = the remainder). Every value is captured as-is;
 * namespace selection (e.g. excluding ETCS:) is a comparison policy, not a
 * parsing one (see spec-compare.js).
 *
 * Unlike a naive Map<key, value> walk, a single preset key can offer several
 * values (a <combo>/<multiselect> with a values= list or multiple <list_entry>
 * children). collectPairs() therefore emits a flat list of [key, value] tuples
 * so no alternative value is lost; pair-level dedup happens in parsePresetXML().
 *
 * Supported value carriers:
 *   <key value>                         single tag value
 *   <combo|multiselect value>           default value
 *   <combo|multiselect values [delimiter]> delimiter-separated value list
 *   <list_entry value>                  one option of a combo/multiselect
 *   <check value_on value_off>          binary tag states
 * <reference ref> are resolved against <chunk id> with a cycle guard.
 * <item>, <group>, <optional> and other containers are traversed recursively.
 *
 * Pure module: no DOM-of-page access, no app config. Network access lives in
 * fetchPresetXML(); everything else is side-effect free and unit-testable.
 *
 * Public API:
 *   parsePresetXML(xmlString) -> PresetSpec
 *   fetchPresetXML(url)       -> Promise<PresetSpec>
 *
 * PresetSpec (same shape as wiki-parser.js WikiSpec, so both diff identically):
 *   pairs:  Array<{ cat: string, type: string }>
 *   byCat:  Map<string, Set<string>>
 *   byType: Map<string, Set<string>>
 */

const SIGNAL_KEY_PREFIX = 'railway:signal:';
// JOSM default value separator for the values= list: comma for <combo>,
// semicolon for <multiselect> (which also joins selected values with it).
// An explicit delimiter="" attribute overrides these.
const COMBO_DELIMITER = ',';
const MULTISELECT_DELIMITER = ';';

// ===== Public API =====

/**
 * Parse a JOSM preset XML string into a PresetSpec.
 *
 * Captures every railway:signal:* value as-is. No namespace filtering happens
 * here: which namespaces to compare (e.g. excluding ETCS:, which comes from a
 * separate spec) is a comparison policy applied in spec-compare.js.
 *
 * @param {string} xmlString
 * @returns {PresetSpec}
 */
export function parsePresetXML(xmlString) {
    const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    const error = doc.querySelector('parsererror');
    if (error) throw new Error(`Invalid XML: ${error.textContent}`);

    const chunks = _indexChunks(doc);

    const pairs = [];
    const byCat = new Map();
    const byType = new Map();
    const seen = new Set();

    // Roots that hold tags: each top-level <item> plus any free-standing
    // <chunk> (collectPairs resolves nested references on demand).
    for (const item of doc.querySelectorAll('item')) {
        for (const [key, value] of collectPairs(item, chunks)) {
            if (!key.startsWith(SIGNAL_KEY_PREFIX)) continue;

            const cat = key.slice(SIGNAL_KEY_PREFIX.length);
            const pairKey = `${cat}|${value}`;
            if (seen.has(pairKey)) continue;
            seen.add(pairKey);

            pairs.push({ cat, type: value });
            if (!byCat.has(cat)) byCat.set(cat, new Set());
            if (!byType.has(value)) byType.set(value, new Set());
            byCat.get(cat).add(value);
            byType.get(value).add(cat);
        }
    }

    return { pairs, byCat, byType };
}

/**
 * Fetch a preset XML from a URL (or relative path) and parse it.
 * No caching: the local-testing workflow edits the XML and reloads, so a
 * cache would serve stale results.
 *
 * @param {string} url
 * @returns {Promise<PresetSpec>}
 */
export async function fetchPresetXML(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return parsePresetXML(await res.text());
}

// ===== Private =====

/** Index every <chunk id="..."> so <reference ref="..."> can resolve it. */
function _indexChunks(doc) {
    const chunks = new Map();
    for (const chunk of doc.querySelectorAll('chunk')) {
        const id = chunk.getAttribute('id');
        if (id) chunks.set(id, chunk);
    }
    return chunks;
}

/**
 * Recursively collect [key, value] tuples carried by an element and its
 * descendants, following <reference> into <chunk>.
 *
 * @param {Element} el
 * @param {Map<string, Element>} chunks
 * @param {Set<string>} [visited]  Chunk ids on the current path (cycle guard).
 * @returns {Array<[string, string]>}
 */
function collectPairs(el, chunks, visited = new Set()) {
    const out = [];

    for (const child of el.children) {
        switch (child.tagName) {
            case 'key':
                _pushKey(out, child);
                break;
            case 'combo':
            case 'multiselect':
                _pushChoice(out, child);
                break;
            case 'check':
                _pushCheck(out, child);
                break;
            case 'reference':
                _resolveReference(out, child, chunks, visited);
                break;
            default:
                // Structural container (item, group, optional, ...): descend.
                out.push(...collectPairs(child, chunks, visited));
        }
    }

    return out;
}

/** <key key value> -> single tuple. */
function _pushKey(out, el) {
    const key = el.getAttribute('key');
    const value = el.getAttribute('value');
    if (key && value !== null) out.push([key, value]);
}

/** <combo>/<multiselect>: default value + values= list + <list_entry> options. */
function _pushChoice(out, el) {
    const key = el.getAttribute('key');
    if (!key) return;

    const value = el.getAttribute('value');
    if (value !== null) out.push([key, value]);

    const values = el.getAttribute('values');
    if (values !== null) {
        const fallback = el.tagName === 'multiselect'
            ? MULTISELECT_DELIMITER : COMBO_DELIMITER;
        const delimiter = el.getAttribute('delimiter') || fallback;
        for (const v of values.split(delimiter)) out.push([key, v]);
    }

    for (const entry of el.children) {
        if (entry.tagName !== 'list_entry') continue;
        const ev = entry.getAttribute('value');
        if (ev !== null) out.push([key, ev]);
    }
}

/**
 * <check key value_on value_off disable_off> -> up to two tuples.
 * JOSM defaults: value_on="yes", value_off="no". disable_off="true" means the
 * unchecked state sets no tag at all, so only the "on" value is emitted. Empty
 * values are skipped.
 */
function _pushCheck(out, el) {
    const key = el.getAttribute('key');
    if (!key) return;

    const on = el.getAttribute('value_on') ?? 'yes';
    if (on) out.push([key, on]);

    if (el.getAttribute('disable_off') === 'true') return; // off sets no tag
    const off = el.getAttribute('value_off') ?? 'no';
    if (off) out.push([key, off]);
}

/** <reference ref="id"> -> expand the matching <chunk>, guarding cycles. */
function _resolveReference(out, el, chunks, visited) {
    const id = el.getAttribute('ref');
    if (!id || visited.has(id) || !chunks.has(id)) return;
    visited.add(id);
    out.push(...collectPairs(chunks.get(id), chunks, visited));
    visited.delete(id);
}

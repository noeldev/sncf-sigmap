/**
 * spec-compare.js - Cross-check signal OSM definitions against the wiki spec.
 *
 * Compares {cat, type} pairs derived from OSM values:
 *   - Code side: all possible (cat, type) outputs from getAllOsmPairs(),
 *     which covers both SIGNAL_MAPPING (luminous) and MECHANICAL_MAPPING
 *     (always-mechanical: R30, RR30; combo-mechanical: CARRE, A, D).
 *   - Wiki side: {cat, type} pairs extracted from the rendered HTML by
 *     wiki-parser.js.
 *
 * Results:
 *   matched    - {cat, type} pair present in both wiki and code.
 *   onlyInWiki - pair in wiki but no code entry produces it.
 *   onlyInCode - pair in code but absent from the wiki.
 *                Sub-classified by catKnown:
 *                  true  - the category exists in the wiki but with a different
 *                          type value (likely a type mismatch).
 *                  false - the category is entirely absent from the wiki
 *                          (intentional extension or undocumented SNCF code).
 *
 * Public API:
 *   buildCodeSpec()              - CodeSpec (derived from signal-types.js)
 *   compareSpecs(wikiSpec, codeSpec) - DiffResult
 *
 * Types:
 *   CodeSpec   = Map<pairKey, { cat, type, signalKeys[] }>
 *   DiffResult = { matched, onlyInWiki, onlyInCode }
 */

import { getAllOsmPairs } from '../signal-types.js';

// ===== Public API =====

/**
 * Build a lookup structure from all OSM-generating signal definitions.
 * Groups GAIA signal codes by their {cat, type} OSM pair so that multiple
 * codes producing the same OSM pair are listed together as context.
 *
 * Includes both luminous (SIGNAL_MAPPING) and mechanical (MECHANICAL_MAPPING)
 * entries via getAllOsmPairs(). Duplicate pairs are collapsed automatically.
 *
 * @returns {CodeSpec}
 */
export function buildCodeSpec() {
    const spec = new Map();

    for (const { cat, type, signalKey } of getAllOsmPairs()) {
        const pairKey = `${cat}|${type}`;
        if (!spec.has(pairKey)) {
            spec.set(pairKey, { cat, type, signalKeys: [] });
        }
        spec.get(pairKey).signalKeys.push(signalKey);
    }

    return spec;
}

/**
 * Compare wiki-derived {cat, type} pairs against code-derived pairs.
 *
 * @param {WikiSpec} wikiSpec   From wiki-parser.js fetchWikiSpec().
 * @param {CodeSpec} codeSpec   From buildCodeSpec().
 * @returns {{ matched, onlyInWiki, onlyInCode }}
 */
export function compareSpecs(wikiSpec, codeSpec) {
    const matched = [];
    const onlyInWiki = [];
    const onlyInCode = [];

    for (const { cat, type } of wikiSpec.pairs) {
        const pairKey = `${cat}|${type}`;
        if (codeSpec.has(pairKey)) {
            matched.push({ cat, type, signalKeys: codeSpec.get(pairKey).signalKeys });
        } else {
            onlyInWiki.push({ cat, type });
        }
    }

    for (const [, entry] of codeSpec) {
        const wikiTypesForCat = wikiSpec.byCat.get(entry.cat);
        if (wikiTypesForCat?.has(entry.type)) continue;
        const catKnown = wikiSpec.byCat.has(entry.cat);
        onlyInCode.push({ cat: entry.cat, type: entry.type, signalKeys: entry.signalKeys, catKnown });
    }

    return { matched, onlyInWiki, onlyInCode };
}

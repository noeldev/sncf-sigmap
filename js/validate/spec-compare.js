/**
 * spec-compare.js - Cross-check SIGNAL_MAPPING entries against the wiki spec.
 *
 * Compares {cat, type} pairs derived from OSM values only:
 *   - SIGNAL_MAPPING side: uses def.cat and def.type (the OSM values, e.g.
 *     cat="speed_limit_distant", type="FR:TIV-D_MOB"). The SNCF/GAIA code
 *     keys (e.g. "TIV D MOB") are not compared to anything -- they are
 *     included in matched/onlyInCode entries as informational context only.
 *   - Wiki side: {cat, type} pairs extracted from the rendered HTML by
 *     wiki-parser.js.
 *
 * Results:
 *   matched    - {cat, type} pair present in both wiki and SIGNAL_MAPPING.
 *   onlyInWiki - pair in wiki but no SIGNAL_MAPPING entry produces it.
 *                Signal types documented in the wiki but not yet mapped.
 *   onlyInCode - pair in SIGNAL_MAPPING but absent from the wiki.
 *                Sub-classified by catKnown:
 *                  true  - the category exists in the wiki but with a
 *                          different type value (likely a type mismatch,
 *                          e.g. SIGNAL_MAPPING has FR:C but wiki shows
 *                          a different type for that cat).
 *                  false - the category is entirely absent from the wiki
 *                          (intentional extension or undocumented SNCF code).
 *
 * Public API:
 *   buildCodeSpec(signalMapping)     - CodeSpec
 *   compareSpecs(wikiSpec, codeSpec) - DiffResult
 *
 * Types:
 *   CodeSpec   = Map<pairKey, { cat, type, signalKeys[] }>
 *   DiffResult = { matched, onlyInWiki, onlyInCode }
 */

// ===== Public API =====

/**
 * Build a lookup structure from SIGNAL_MAPPING for comparison.
 * Groups SNCF signal codes by their {cat, type} OSM pair so that multiple
 * SNCF codes producing the same OSM pair are listed together as context.
 *
 * @param {object} signalMapping
 * @returns {CodeSpec}
 */
export function buildCodeSpec(signalMapping) {
    const spec = new Map();

    for (const [gaiaKey, def] of Object.entries(signalMapping)) {
        const pairKey = `${def.cat}|${def.type}`;
        if (!spec.has(pairKey)) {
            spec.set(pairKey, { cat: def.cat, type: def.type, signalKeys: [] });
        }
        spec.get(pairKey).signalKeys.push(gaiaKey);
    }

    return spec;
}

/**
 * Compare wiki-derived {cat, type} pairs against SIGNAL_MAPPING-derived pairs.
 *
 * @param {WikiSpec} wikiSpec   From wiki-parser.js fetchWikiSpec().
 * @param {CodeSpec} codeSpec   From buildCodeSpec().
 * @returns {{ matched, onlyInWiki, onlyInCode }}
 */
export function compareSpecs(wikiSpec, codeSpec) {
    const matched = [];
    const onlyInWiki = [];
    const onlyInCode = [];

    // Wiki side: classify each wiki pair against codeSpec.
    for (const { cat, type } of wikiSpec.pairs) {
        const pairKey = `${cat}|${type}`;
        if (codeSpec.has(pairKey)) {
            matched.push({ cat, type, signalKeys: codeSpec.get(pairKey).signalKeys });
        } else {
            onlyInWiki.push({ cat, type });
        }
    }

    // Code side: find SIGNAL_MAPPING OSM pairs absent from the wiki.
    for (const [, entry] of codeSpec) {
        const wikiTypesForCat = wikiSpec.byCat.get(entry.cat);
        if (wikiTypesForCat?.has(entry.type)) continue;  // already counted in matched

        // catKnown: true if the wiki knows the category but with a different type value.
        const catKnown = wikiSpec.byCat.has(entry.cat);
        onlyInCode.push({ cat: entry.cat, type: entry.type, signalKeys: entry.signalKeys, catKnown });
    }

    return { matched, onlyInWiki, onlyInCode };
}

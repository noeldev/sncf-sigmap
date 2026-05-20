/**
 * spec-compare.js — Cross-check SIGNAL_MAPPING entries against the wiki spec.
 *
 * Operates on two independently sourced sets of {cat, type} pairs and produces
 * a diff that classifies every entry into one of three buckets:
 *
 *   matched    — cat+type pair present in both sources (correct).
 *   onlyInWiki — pair exists in wiki but no SIGNAL_MAPPING entry uses it.
 *                These are signal types documented but not yet implemented.
 *   onlyInCode — pair exists in SIGNAL_MAPPING but the wiki does not define it.
 *                These are candidates for bugs (wrong type value) or extensions.
 *                Sub-classified by catKnown:
 *                  true  → the category exists in wiki but with a different type
 *                           value (likely a type string mismatch, e.g. FR:CARRE
 *                           instead of the wiki's FR:C).
 *                  false → the category is entirely absent from the wiki
 *                           (intentional extension or undocumented SNCF code).
 *
 * Public API:
 *   buildCodeSpec(signalMapping)     → CodeSpec
 *   compareSpecs(wikiSpec, codeSpec) → DiffResult
 *
 * Types:
 *   CodeSpec   = Map<pairKey, { cat, type, sncfKeys[] }>
 *   DiffResult = { matched, onlyInWiki, onlyInCode }
 */

// ===== Public API =====

/**
 * Build a lookup structure from SIGNAL_MAPPING for comparison.
 * Groups SNCF signal codes by their {cat, type} pair so that multiple SNCF
 * codes mapping to the same OSM pair are reported together.
 *
 * @param {object} signalMapping  The SIGNAL_MAPPING constant from signal-types.js.
 * @returns {CodeSpec}
 */
export function buildCodeSpec(signalMapping) {
    const spec = new Map();

    for (const [sncfKey, def] of Object.entries(signalMapping)) {
        const pairKey = `${def.cat}|${def.type}`;
        if (!spec.has(pairKey)) {
            spec.set(pairKey, { cat: def.cat, type: def.type, sncfKeys: [] });
        }
        spec.get(pairKey).sncfKeys.push(sncfKey);
    }

    return spec;
}

/**
 * Compare a wiki-derived spec against the code-derived spec.
 *
 * @param {WikiSpec} wikiSpec   From wiki-parser.js fetchWikiSpec().
 * @param {CodeSpec} codeSpec   From buildCodeSpec().
 * @returns {DiffResult}
 */
export function compareSpecs(wikiSpec, codeSpec) {
    const matched    = [];
    const onlyInWiki = [];
    const onlyInCode = [];

    // ── Wiki side: classify each wiki pair ──
    for (const { cat, type } of wikiSpec.pairs) {
        const pairKey = `${cat}|${type}`;
        if (codeSpec.has(pairKey)) {
            matched.push({ cat, type, sncfKeys: codeSpec.get(pairKey).sncfKeys });
        } else {
            onlyInWiki.push({ cat, type });
        }
    }

    // ── Code side: find entries absent from wiki ──
    for (const [, entry] of codeSpec) {
        const wikiTypesForCat = wikiSpec.byCat.get(entry.cat);
        if (wikiTypesForCat?.has(entry.type)) continue;    // already in matched

        // catKnown=true  → category exists in wiki but with a different type value.
        // catKnown=false → category is entirely absent from the wiki page.
        const catKnown = wikiSpec.byCat.has(entry.cat);

        onlyInCode.push({ cat: entry.cat, type: entry.type, sncfKeys: entry.sncfKeys, catKnown });
    }

    return { matched, onlyInWiki, onlyInCode };
}

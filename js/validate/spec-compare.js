// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * spec-compare.js - Cross-check signal OSM definitions against the wiki spec.
 *
 * Compares {cat, type} pairs derived from OSM values:
 *   - Code side: all possible (cat, type) outputs from getAllOsmPairs(),
 *     which covers all signal types defined in signal-types.js (luminous
 *     and mechanical entries included via getAllOsmPairs()). These are all
 *     primary catalog cats (depth-1, no ":" qualifier).
 *   - Wiki side: {cat, type} pairs extracted from the wiki by wiki-parser.js
 *     (complete documented set).
 *
 * compareSpecs() scopes to the wiki's catalog subset (depth-1 cats) since the
 * code only emits catalog pairs; depth>=2 sub-keys are handled by the preset
 * cross-check. This structural scope replaces the former suffix denylist.
 *
 * Results:
 *   matched    - {cat, type} pair present in both wiki and code.
 *   onlyInWiki - catalog pair in wiki but no code entry produces it.
 *   onlyInCode - pair in code but absent from the wiki.
 *                Sub-classified by catKnown:
 *                  true  - the category exists in the wiki but with a different
 *                          type value (likely a type mismatch).
 *                  false - the category is entirely absent from the wiki
 *                          (intentional extension or undocumented SNCF code).
 *
 * A second comparison checks the JOSM presets against the same wiki spec, over
 * the FULL documented set. The wiki is the reference.
 *   onlyInWiki   - pair documented in the wiki but absent from the presets.
 *   onlyInPreset - pair defined in the presets but absent from the wiki.
 *
 * Public API:
 *   buildCodeSpec()                       - CodeSpec (from signal-types.js)
 *   compareSpecs(wikiSpec, codeSpec)      - SpecDiff
 *   comparePresetToWiki(wikiSpec, preset) - PresetDiff
 *
 * Types:
 *   CodeSpec   = Map<pairKey, { cat, type, signalKeys[] }>
 *   SpecDiff   = { matched, onlyInWiki, onlyInCode }
 *   PresetDiff = { matched, onlyInWiki, onlyInPreset }
 */

import { getAllOsmPairs } from '../signal-types.js';

// ===== Public API =====

/**
 * Build a lookup structure from all OSM-generating signal definitions.
 * Groups GAIA signal codes by their {cat, type} OSM pair so that multiple
 * codes producing the same OSM pair are listed together as context.
 *
 * Covers all OSM-generating entries via getAllOsmPairs().
 * Duplicate pairs are collapsed automatically.
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
 * getAllOsmPairs() emits only primary catalog cats (depth-1, no ":" qualifier)
 * with namespaced values (e.g. FR:C), so the comparison is scoped to the wiki's
 * catalog subset: depth-1 cats whose value is namespaced and not in an excluded
 * namespace. Depth>=2 wiki keys (states, shapes, ...) and bare-valued depth-1
 * keys (direction=forward, position=left) are not signal-type catalog entries
 * and belong to the preset cross-check, not here.
 *
 * @param {WikiSpec} wikiSpec   From wiki-parser.js fetchWikiSpec().
 * @param {CodeSpec} codeSpec   From buildCodeSpec().
 * @param {string[]} [excluded] Value namespaces to skip (default ['ETCS:']).
 * @returns {{ matched, onlyInWiki, onlyInCode }}
 */
export function compareSpecs(wikiSpec, codeSpec, excluded = EXCLUDED_NAMESPACES) {
    const matched = [];
    const onlyInWiki = [];
    const onlyInCode = [];

    const inScope = type => _isNamespaced(type) && !_excluded(type, excluded);
    const catalog = wikiSpec.pairs.filter(p => _isCatalogCat(p.cat) && inScope(p.type));
    const catalogCats = new Set(catalog.map(p => p.cat));

    for (const { cat, type } of catalog) {
        const pairKey = `${cat}|${type}`;
        if (codeSpec.has(pairKey)) {
            matched.push({ cat, type, signalKeys: codeSpec.get(pairKey).signalKeys });
        } else {
            onlyInWiki.push({ cat, type });
        }
    }

    for (const [, entry] of codeSpec) {
        if (_excluded(entry.type, excluded)) continue; // ETCS: comes from another spec
        const wikiTypesForCat = wikiSpec.byCat.get(entry.cat);
        if (wikiTypesForCat?.has(entry.type)) continue;
        const catKnown = catalogCats.has(entry.cat);
        onlyInCode.push({ cat: entry.cat, type: entry.type, signalKeys: entry.signalKeys, catKnown });
    }

    return { matched, onlyInWiki, onlyInCode };
}

/**
 * Compare JOSM preset {cat, type} pairs against the wiki spec.
 *
 * The wiki is the reference. A preset value is only meaningfully comparable
 * when the wiki actually enumerates values for that key; the wiki documents
 * keys at three levels:
 *
 *   - key enumerated (byCat has the cat)  -> validate the value (see below).
 *   - key documented but NOT enumerated (e.g. railway:signal:main:states, which
 *     links to a sub-page instead of listing states) -> the value is ignored;
 *     only the key presence matters, and it is present, so nothing is flagged.
 *   - key not documented at all -> onlyInPreset (undocumented key).
 *
 * Value validation splits on ";" because a preset value can combine several
 * enumerated states (the wiki documents them as ";"-separated), e.g.
 * route:states=FR:ID1;FR:ID2 lists two route IDs. Each atom must be an
 * enumerated wiki value; the combined value matches when all of its atoms do.
 * For plain values (no ";") this is a no-op. The reverse direction reports
 * enumerated wiki values whose atom appears in no preset value as onlyInWiki.
 *
 * Values from excluded namespaces (default ETCS:, which comes from a separate
 * ERTMS spec on another wiki) are skipped on both sides. All other values are
 * compared, including bare ones (light, forward), so the whole French scheme is
 * validated rather than only the FR: subset.
 *
 * @param {WikiSpec}   wikiSpec    From wiki-parser.js fetchWikiSpec().
 * @param {PresetSpec} presetSpec  From preset-parser.js parsePresetXML().
 * @param {string[]}   [excluded]  Value namespaces to skip (default ['ETCS:']).
 * @returns {{ matched, onlyInWiki, onlyInPreset }}
 */
export function comparePresetToWiki(wikiSpec, presetSpec, excluded = EXCLUDED_NAMESPACES) {
    const inScope = type => !_excluded(type, excluded);
    const presetPairs = presetSpec.pairs.filter(p => inScope(p.type));

    // Every atom of every preset value, keyed by cat, so a combined value
    // covers each of its enumerated atoms.
    const presetAtoms = new Set();
    for (const pair of presetPairs) {
        for (const atom of _atoms(pair.type)) presetAtoms.add(`${pair.cat}|${atom}`);
    }

    const matched = [];
    const onlyInWiki = [];
    const onlyInPreset = [];

    for (const pair of presetPairs) {
        if (wikiSpec.byCat.has(pair.cat)) {
            const enumerated = wikiSpec.byCat.get(pair.cat);
            const allKnown = _atoms(pair.type).every(atom => enumerated.has(atom));
            (allKnown ? matched : onlyInPreset).push(pair);
        } else if (!wikiSpec.keys.has(pair.cat)) {
            onlyInPreset.push(pair); // key not documented anywhere in the wiki
        }
        // else: documented key without an enumerated value list -> value ignored.
    }

    for (const pair of wikiSpec.pairs) {
        if (inScope(pair.type) && !presetAtoms.has(_pairKey(pair))) onlyInWiki.push(pair);
    }

    return { matched, onlyInWiki, onlyInPreset };
}

// ===== Private helpers =====

// Value namespaces that come from a separate spec and are excluded from both
// comparisons by default. ETCS:/ERTMS values are documented on another wiki.
const EXCLUDED_NAMESPACES = ['ETCS:'];

// Separator used by JOSM presets and the wiki to combine enumerated states,
// e.g. railway:signal:route:states=FR:ID1;FR:ID2.
const VALUE_SEPARATOR = ';';

/** Split a (possibly combined) value into its enumerated atoms. */
function _atoms(value) {
    return value.split(VALUE_SEPARATOR).map(v => v.trim()).filter(Boolean);
}

/** A namespaced value carries a "<NS>:" prefix (e.g. FR:C); bare values do not. */
function _isNamespaced(value) {
    return value.includes(':');
}

/** True when the value belongs to one of the excluded namespaces. */
function _excluded(value, prefixes) {
    return prefixes.some(prefix => value.startsWith(prefix));
}

/**
 * A "catalog" cat is a primary signal category: the first segment after
 * railway:signal: with no further qualifier (no ":"). Depth>=2 keys
 * (main:states, main:shape, ...) are property/enumeration sub-tags.
 */
function _isCatalogCat(cat) {
    return !cat.includes(':');
}

/** Stable identity key for a {cat, type} pair. */
function _pairKey({ cat, type }) {
    return `${cat}|${type}`;
}

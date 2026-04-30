/**
 * filter-data.js — Signal count accumulation and value index.
 *
 * Owns the per-field data maps populated by tile loading (indexSignals)
 * and index.json parsing (parseFieldIndex). Pure data layer: no DOM,
 * no i18n, no FilterPanel references.
 *
 * All public functions accept a flat array of field *keys* (string[]),
 * never UI metadata objects.
 *
 * Public API:
 *   initFieldState(fieldKeys)
 *   parseFieldIndex(data, fieldKeys)
 *   accumulateSignals(signals, fieldKeys)   → boolean
 *   resetLiveCounts(fieldKeys)
 *   resetKnownValues(fieldKeys)
 *   getCountMap(field, preferGlobal)
 *   getCandidateValues(field, opts)
 *   normalize(str)
 *   buildItemSorter(fieldMeta, isSignalType, numericSort)
 */


// ===== Accumulated data — private to this module =====

let _counts = {};           // per-field live signal counts from tiles (Map<string, number>)
let _globalCounts = {};     // per-value counts from index.json (full dataset, always accurate)
let _knownValues = {};      // accumulated across tile loads; never reset by resetLiveCounts()
let _indexValues = {};      // pre-loaded value lists from index.json


// ===== Initialisation =====

/**
 * Create empty per-field data maps.
 * @param {string[]} fieldKeys
 */
export function initFieldState(fieldKeys) {
    for (const key of fieldKeys) {
        _indexValues[key] = [];
        _counts[key] = new Map();
        _knownValues[key] = new Set();
        _globalCounts[key] = null;
    }
}

/**
 * Populate index values and global counts from index.json data.
 * @param {object} data       Parsed index.json content.
 * @param {string[]} fieldKeys
 */
export function parseFieldIndex(data, fieldKeys) {
    for (const key of fieldKeys) {
        const entry = data[key];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        _indexValues[key] = Object.keys(entry);
        _globalCounts[key] = new Map(
            Object.entries(entry).map(([k, v]) =>
                [k, typeof v === 'object' && v !== null ? v.count : v]
            )
        );
    }
}


// ===== Tile data accumulation =====

/**
 * Accumulate per-field value counts from a batch of normalized signals.
 * @param {object[]} signals  Flat array of { p: { [fieldKey]: string } }.
 * @param {string[]} fieldKeys
 * @returns {boolean} true when at least one count changed.
 */
export function accumulateSignals(signals, fieldKeys) {
    let changed = false;
    for (const s of signals) {
        for (const key of fieldKeys) {
            const v = s.p[key];
            if (v) {
                _counts[key].set(v, (_counts[key].get(v) || 0) + 1);
                _knownValues[key].add(v);
                changed = true;
            }
        }
    }
    return changed;
}

/**
 * Clear all per-field live signal counts.
 * Called at the start of each worker cycle before new data arrives.
 * @param {string[]} fieldKeys
 */
export function resetLiveCounts(fieldKeys) {
    for (const key of fieldKeys) _counts[key] = new Map();
}

/**
 * Clear known values — called on full filter reset only.
 * @param {string[]} fieldKeys
 */
export function resetKnownValues(fieldKeys) {
    for (const key of fieldKeys) _knownValues[key] = new Set();
}


// ===== Getters =====

/**
 * Return the best available count map for a field.
 * In overview (sampled) mode, global counts from index.json are preferred
 * because the spatial sample is not representative of the full dataset.
 * @param {string} field
 * @param {boolean} preferGlobal  true when isSampled().
 * @returns {Map<string, number> | null}
 */
export function getCountMap(field, preferGlobal) {
    return preferGlobal
        ? (_globalCounts[field] ?? _counts[field])
        : (_counts[field] ?? _globalCounts[field]);
}

/**
 * Build the merged candidate value list for a filter field.
 * @param {string}  field
 * @param {{ mappedOnly: boolean, mappedTypes: Set<string>, isSignalType: boolean }} opts
 * @returns {string[]}
 */
export function getCandidateValues(field, { mappedOnly, mappedTypes, isSignalType }) {
    const fromIndex = _indexValues[field] || [];
    const fromCounts = [...(_counts[field]?.keys() || [])];
    const base = fromIndex.length > 0
        ? [...new Set([...fromIndex, ...fromCounts])]
        : [...new Set([...(_knownValues[field] || []), ...fromCounts])];
    if (mappedOnly && isSignalType) return base.filter(v => mappedTypes.has(v));
    return base;
}


// ===== Pure helpers =====

/**
 * Normalize a string for case-insensitive search comparison.
 * @param {string} str
 * @returns {string}
 */
export function normalize(str) {
    return str.toUpperCase();
}

/**
 * Return a comparator for dropdown item sorting.
 * Priority: explicit valueOrder > count-descending (signalType) > numeric > alphabetical.
 *
 * @param {object|null} fieldMeta
 * @param {boolean}     isSignalType
 * @param {boolean}     numericSort
 * @returns {(a: {v:string, count:number}, b: {v:string, count:number}) => number}
 */
export function buildItemSorter(fieldMeta, isSignalType, numericSort) {
    if (fieldMeta?.valueOrder) {
        const order = fieldMeta.valueOrder;
        return (a, b) => {
            const ia = order.indexOf(a.v);
            const ib = order.indexOf(b.v);
            if (ia >= 0 && ib >= 0) return ia - ib;
            if (ia >= 0) return -1;
            if (ib >= 0) return 1;
            return a.v.localeCompare(b.v);
        };
    }
    if (isSignalType)
        return (a, b) => (b.count - a.count) || a.v.localeCompare(b.v);
    if (numericSort)
        return (a, b) => a.v.localeCompare(b.v, undefined, { numeric: true });
    return (a, b) => a.v.localeCompare(b.v);
}

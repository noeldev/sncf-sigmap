/**
 * osm-diff.js — Tag comparison and target state management.
 *
 * Two responsibilities bundled here, both about OSM vs app-generated tags:
 *
 *   1. computeTagDiff() — pure read-only comparison between two tag sets.
 *
 *   2. Target tag state (createTargetState + mutators) — an editable Map the
 *      user builds by merging OSM corrections or undoing them back to the
 *      app-generated values.
 *
 * Design invariants:
 *   - App-generated tags are the source of truth (SNCF data + the
 *     OpenRailwayMap signalling schema). OSM values are merged as occasional
 *     corrections for a subset of keys (states, form, speed…).
 *   - Target tags are never "deleted" by the user. The only way a key leaves
 *     the target is when it was previously merged from OSM-only (not in the
 *     original appTags) and the user undoes that merge.
 *   - Each data mutation ('merge', 'mergeAll', 'undo', 'undoAll') pushes a
 *     snapshot of the previous target on the undo stack, so Ctrl+Z / Ctrl+Y
 *     (undoHistory / redoHistory) can walk the timeline.
 *
 * Two undo concepts, kept distinct:
 *   - 'undo' / 'undoAll' are DATA actions: they restore one key (or all keys)
 *     to the original app-generated value. They show up in the context menu.
 *   - 'undoHistory' / 'redoHistory' are TIMELINE actions: they pop the last
 *     snapshot off the past/future stack. They are bound to Ctrl+Z / Ctrl+Y
 *     in the UI.
 *
 * Scope:
 *   Compared keys are those matching the predicate passed as third argument.
 *   Default scope covers the SNCF signal tagging schema:
 *     - 'railway=signal'    (top-level)
 *     - 'railway:signal:*'  (category, form, plate, shape, states, ref, ...)
 *   OSM-only metadata (source, operator, note, survey:date, ref, ...) is
 *   ignored by design so it never shows up as a false divergence and never
 *   pollutes the target during a batch merge. The predicate is parameterised
 *   so callers can broaden or narrow the scope as needed.
 *
 * Public API:
 *   computeTagDiff(appTags, osmTags, inScope?)   pure diff
 *   createTargetState(appTags)                   state factory
 *   merge(state, key, osmValue)                  1 key : OSM → target
 *   mergeAll(state, osmTags, inScope?)           all missing OSM keys
 *   undo(state, key, appTags)                    1 key : target → app
 *   undoAll(state, appTags)                      whole target → app
 *   undoHistory(state) / redoHistory(state)      timeline navigation
 */


// ===== Default comparison scope =====

/**
 * Default predicate: a key participates in the diff when it belongs to the
 * SNCF signal tagging schema. Everything outside this scope is ignored so OSM
 * metadata (source, operator, note, survey:date, ref, ...) never surfaces as
 * a false divergence.
 *
 * @param {string} k  tag key.
 * @returns {boolean}
 */
const DEFAULT_SCOPE = (k) =>
    k === 'railway' || k.startsWith('railway:signal:');


// ===== History limits =====

// Each past/future entry is a Map<string,string> — in practice dozens of
// entries at most. Generous limit protects against runaway memory on
// automated / stress-testing scenarios.
const HISTORY_LIMIT = 100;


// ===== Public API — pure diff =====

/**
 * Compute the divergence between a target tag set and actual OSM tags.
 *
 * A key is divergent when:
 *   - it is in 'appTags' but missing from OSM  (→ will be added by export),
 *   - it is in both with different values      (→ value mismatch),
 *   - it is in OSM but not in 'appTags'        (→ OSM-only, informational).
 *
 * @param {Map<string, string>}    appTags   Target tag set to compare.
 * @param {object | null}          osmTags   Tags returned by Overpass, or null.
 * @param {(k: string) => boolean} [inScope] Which keys participate in the diff
 *                                           (default: SNCF schema).
 * @returns {Map<string, { expected: string|null, actual: string|null }> | null}
 *   'expected' is the value in 'appTags' (null → OSM-only).
 *   'actual'   is the value currently in OSM (null → target-only).
 *   Insertion order reflects 'appTags' first, then OSM-only keys.
 *   Returns null when 'osmTags' is null or no divergence is found within scope.
 */
export function computeTagDiff(appTags, osmTags, inScope = DEFAULT_SCOPE) {
    if (!osmTags) return null;
    const src = appTags ?? new Map();
    const divergent = new Map();

    // Pass 1 — target keys missing or mismatched in OSM.
    // Iteration order matches 'appTags', so downstream rendering stays stable.
    for (const [k, expected] of src) {
        if (!inScope(k)) continue;
        const actual = osmTags[k] ?? null;
        if (actual !== expected) divergent.set(k, { expected, actual });
    }

    // Pass 2 — OSM-only keys not present in the target.
    for (const k of Object.keys(osmTags)) {
        if (!inScope(k) || src.has(k)) continue;
        divergent.set(k, { expected: null, actual: osmTags[k] });
    }

    return divergent.size === 0 ? null : divergent;
}


// ===== Public API — state factory =====

/**
 * Create a new target state initialised with a clone of the app-generated
 * tags. The 'target' field is the editable Map, 'past' and 'future' are the
 * undo/redo stacks used by undoHistory / redoHistory.
 *
 * @param {Map<string,string>} appTags  Initial app-generated tags.
 * @returns {{ target: Map<string,string>, past: Map<string,string>[], future: Map<string,string>[] }}
 */
export function createTargetState(appTags) {
    return {
        target: new Map(appTags ?? []),
        past: [],
        future: [],
    };
}


// ===== Public API — data mutations =====

/**
 * Merge a single OSM value into the target, overwriting any existing value
 * for that key.
 *
 * @param {object} state     Target state created by createTargetState.
 * @param {string} key       Tag key to set.
 * @param {string} osmValue  Value coming from OSM.
 * @returns {boolean} true when the target actually changed.
 */
export function merge(state, key, osmValue) {
    if (state.target.get(key) === osmValue) return false;
    _snapshot(state);
    state.target.set(key, osmValue);
    return true;
}

/**
 * Merge every in-scope OSM key into the target. Existing target values are
 * overwritten when they differ from the OSM value (the user can roll back via
 * Undo all or Ctrl+Z). Pushes a single history entry regardless of how many
 * keys were touched.
 *
 * @param {object}                 state      Target state to mutate.
 * @param {object | null}          osmTags    Tags returned by Overpass.
 * @param {(k: string) => boolean} [inScope]  Filter for eligible keys
 *                                            (default: SNCF schema).
 * @returns {boolean} true if at least one change was made.
 */
export function mergeAll(state, osmTags, inScope = DEFAULT_SCOPE) {
    if (!osmTags) return false;

    let changed = false;
    const entries = Object.entries(osmTags);

    for (const [k, v] of entries) {
        if (!inScope(k)) continue;

        // If value is already identical, skip
        if (state.target.get(k) === v) continue;

        // First change? Take a snapshot for history
        if (!changed) {
            _snapshot(state);
            changed = true;
        }
        state.target.set(k, v);
    }

    return changed;
}
/**
 * Undo the changes made to a single target key, restoring its original
 * app-generated state:
 *   - Key present in appTags → target[key] = appTags[key]
 *   - Key NOT in appTags      → target.delete(key)   (was merged from OSM-only)
 *
 * This is the only path through which a key can be removed from the target,
 * and it is only reachable for keys that were previously added by the user
 * via a merge from an OSM-only row. App keys are never removed — at worst
 * their value is rolled back.
 *
 * @param {object}             state    Target state to mutate.
 * @param {string}             key      Tag key to restore.
 * @param {Map<string,string>} appTags  Original app-generated tags.
 * @returns {boolean} true when the target actually changed.
 */
export function undo(state, key, appTags) {
    const src = appTags ?? new Map();
    if (src.has(key)) {
        const appValue = src.get(key);
        if (state.target.get(key) === appValue) return false;
        _snapshot(state);
        state.target.set(key, appValue);
        return true;
    }
    // App didn't have it — it was merged from OSM. Remove it.
    if (!state.target.has(key)) return false;
    _snapshot(state);
    state.target.delete(key);
    return true;
}

/**
 * Undo every user change at once: replace the target with a fresh clone of
 * the original app-generated tags.
 *
 * @param {object}             state    Target state to mutate.
 * @param {Map<string,string>} appTags  Original app-generated tags.
 * @returns {boolean} true when the target actually changed.
 */
export function undoAll(state, appTags) {
    const src = appTags ?? new Map();
    if (_mapEquals(state.target, src)) return false;
    _snapshot(state);
    state.target = new Map(src);
    return true;
}

/**
 * Internal helper to check if undo is possible.
 */
function _canUndo(state) {
    return state.past.length > 0;
}

/**
 * Internal helper to check if redo is possible.
 */
function _canRedo(state) {
    return state.future.length > 0;
}

// ===== Public API — history navigation (Ctrl+Z / Ctrl+Y) =====

/**
 * Pop the last target snapshot from 'past' and apply it, pushing the current
 * target onto 'future'. Opposite of redoHistory.
 *
 * @param {object} state
 * @returns {boolean} true when a snapshot was applied.
 */
export function undoHistory(state) {
    // Abort if there is no past state to revert to
    if (!_canUndo(state)) return false;

    state.future.push(state.target);
    state.target = state.past.pop();
    return true;
}

/**
 * Pop the next target snapshot from 'future' and apply it, pushing the
 * current target onto 'past'. Opposite of undoHistory.
 *
 * @param {object} state
 * @returns {boolean} true when a snapshot was applied.
 */
export function redoHistory(state) {
    // Abort if there is no future state to re-apply
    if (!_canRedo(state)) return false;

    state.past.push(state.target);
    state.target = state.future.pop();
    return true;
}


// ===== Private helpers =====

/**
 * Push the current target onto 'past' and clear 'future' (every new data
 * mutation invalidates the redo stack — standard editor semantics).
 *
 * Call this BEFORE mutating state.target so the history entry captures the
 * pre-mutation state.
 */
function _snapshot(state) {
    state.past.push(new Map(state.target));
    if (state.past.length > HISTORY_LIMIT) state.past.shift();
    // Clear the redo stack — any new mutation breaks the forward timeline.
    if (state.future.length) state.future.length = 0;
}

/** Shallow equality test between two string → string Maps. */
function _mapEquals(a, b) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
}

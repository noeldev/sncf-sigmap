/**
 * osm-checker.js — OSM existence state machine with caching and automatic retry.
 *
 * Manages the lifecycle of checking whether a signal or a group of co-located
 * signals already exists in OpenStreetMap. Delegates network requests to
 * overpass.js and notifies the caller of state changes via a callback.
 *
 * Cache strategy:
 *   - IN_OSM results are cached permanently for the session (id + tags).
 *   - NOT_IN_OSM results are cached for the lifetime of the current popup instance.
 *   - ERROR results are never cached; they trigger automatic retries.
 *   - Unsupported signals (no OSM mapping) are never sent to Overpass.
 *   - Batch requests exclude signals already known for this instance.
 *
 * Public API (instance):
 *   check()       — start or restart the Overpass check
 *   retry()       — force a fresh check (clears NOT_IN_OSM instance cache)
 *   invalidate()  — alias for retry(); call after a successful JOSM/copy export
 *   abort()       — stop retries and cancel pending fetch when the popup closes
 *   isChecking(idx) / isInOsm(idx) / isNotInOsm(idx) / isUnsupported(idx) / isError(idx)
 *   nodeIdAt(idx) / getOsmTags(idx) / hasAnyInOsm()
 *   getNodeCount()
 *   getNode(idx)
 *   getNodeIdxForSignal(signalIdx)
 *   getOsmTagsForNode(nodeIdx)
 */

import { getIdKey, fetchNodesByRef } from './overpass.js';
import { getSignalId, isSupported, getOsmNodes } from './signal-mapping.js';
import { getOsmNode, primeFromPopup } from './osm-index.js';

const MAX_RETRIES = 5;
const RETRY_DELAY = 2000;

/** Half-width of the Overpass query bbox around a signal group.
 *  0.001 decimal degrees ≈ 111 m at the equator — a comfortable margin
 *  for co-located signals while keeping Overpass queries cheap. */
const BBOX_HALF_DELTA_DEG = 0.001;

// ===== OSM status constants =====

const OSM_STATUS = {
    CHECKING: 'checking',
    IN_OSM: 'in-osm',
    NOT_IN_OSM: 'not-in-osm',
    UNSUPPORTED: 'unsupported',
    ERROR: 'error',
};

/**
 * Build a status record from an Overpass cache entry.
 * @param {string} status
 * @param {{ id: number, tags: object } | null} [entry]
 */
const _makeStatus = (status, entry = null) => ({
    status,
    nodeId: entry?.id ?? null,
    osmTags: entry?.tags ?? null,
});

/**
 * Permanent session-level cache: key -> { id, tags }.
 * IN_OSM signals never need re-checking.
 */
const _inOsmCache = new Map();

/**
 * Look up a networkId in the app-wide OSM index.
 * On hit, promotes the entry to the session cache under the given key
 * so subsequent resolveStatus calls short-circuit without touching the index.
 *
 * @param {string} networkId
 * @param {string} key - getIdKey result for this signal (refTag:networkId).
 * @returns {{ id: number, tags: object } | null}
 */
function _getOsmEntry(networkId, key) {
    const indexNode = getOsmNode(networkId);
    if (!indexNode) return null;
    const entry = { id: indexNode.id, tags: indexNode.tags };
    _inOsmCache.set(key, entry);
    return entry;
}


// ===== OsmStatusChecker class =====

export class OsmStatusChecker {
    // ----- Private fields -----
    #feats;
    #onStatusChange;
    #retryCount = 0;
    #retryTimer = null;
    #notInOsmKeys = new Set();
    #erroredKeys = new Set();
    #statuses;
    #nodes;
    #featToNodeIdx;
    #abortController = null;

    /**
     * @param {object[]} feats           Normalized signal features to check.
     * @param {Function} onStatusChange  Called whenever state changes.
     */
    constructor(feats, onStatusChange) {
        this.#feats = feats;
        this.#onStatusChange = onStatusChange;

        // Centralize grouping of signals into OSM nodes (masts)
        const result = getOsmNodes(feats);
        this.#nodes = result.nodes;
        this.#featToNodeIdx = result.featToNodeIdx;

        // Initialize statuses using session cache (IN_OSM) and instance-level caches
        this.#statuses = feats.map(f => this.#resolveStatus(f));
    }

    // ===== Public API =====

    /** Start or restart the Overpass check. */
    async check() {
        this.#clearRetryTimer();
        this.#retryCount = 0;

        // Abort any in-flight request before starting a new one
        if (this.#abortController) {
            this.#abortController.abort();
        }
        this.#abortController = new AbortController();

        // Reset error statuses to CHECKING
        this.#statuses = this.#statuses.map(s =>
            this.#isError(s) ? _makeStatus(OSM_STATUS.CHECKING) : s
        );
        this.#notify();
        await this.#attemptCheck();
    }

    /** Force a fresh check, clearing the instance NOT_IN_OSM cache. */
    retry() {
        this.#notInOsmKeys.clear();
        this.#erroredKeys.clear();
        this.check();
    }

    /** Alias for retry() — call after a successful copy or JOSM export. */
    invalidate() {
        this.retry();
    }

    /** Stop any pending retry timers and cancel in-flight fetches. Called when popup closes. */
    abort() {
        this.#clearRetryTimer();
        if (this.#abortController) {
            this.#abortController.abort();
            this.#abortController = null;
        }
        this.#onStatusChange = null;
    }

    // ----- Status query methods -----

    isChecking(idx) { return this.#isChecking(this.#statuses[idx]); }
    isInOsm(idx) { return this.#isInOsm(this.#statuses[idx]); }
    isNotInOsm(idx) { return this.#isNotInOsm(this.#statuses[idx]); }
    isUnsupported(idx) { return this.#isUnsupported(this.#statuses[idx]); }
    isError(idx) { return this.#isError(this.#statuses[idx]); }

    /** OSM node ID for the signal at index idx, or null when not in OSM. */
    nodeIdAt(idx) { return this.#statuses[idx]?.nodeId ?? null; }

    /** OSM tags object for the signal at index idx, or null when not in OSM / still checking. */
    getOsmTags(idx) { return this.#statuses[idx]?.osmTags ?? null; }

    /** True when any signal in this group has been found in OSM. */
    hasAnyInOsm() { return this.#statuses.some(s => this.#isInOsm(s)); }

    /** Number of OSM nodes (masts) in the current group. */
    getNodeCount() { return this.#nodes.length; }

    /** Return the node (with .tags) at the given index. */
    getNode(idx) { return this.#nodes[idx]; }

    /** For a given signal index, return the index of the OSM node it belongs to. */
    getNodeIdxForSignal(signalIdx) {
        const feat = this.#feats[signalIdx];
        return this.#featToNodeIdx.get(feat) ?? -1;
    }

    /**
     * Get OSM tags for a node (mast) by looking at any signal belonging to that node.
     * @param {number} nodeIdx
     * @returns {object|null}
     */
    getOsmTagsForNode(nodeIdx) {
        for (let i = 0; i < this.#feats.length; i++) {
            const feat = this.#feats[i];
            if (this.#featToNodeIdx.get(feat) === nodeIdx) {
                const tags = this.getOsmTags(i);
                if (tags) return tags;
            }
        }
        return null;
    }

    // ===== Private status predicates =====

    #isChecking(s) { return s.status === OSM_STATUS.CHECKING; }
    #isInOsm(s) { return s.status === OSM_STATUS.IN_OSM; }
    #isNotInOsm(s) { return s.status === OSM_STATUS.NOT_IN_OSM; }
    #isUnsupported(s) { return s.status === OSM_STATUS.UNSUPPORTED; }
    #isError(s) { return s.status === OSM_STATUS.ERROR; }

    // ===== Private helpers =====

    /**
     * Determine the current status for one signal feature.
     * Consults the session cache, the app-wide OSM index, and instance caches.
     */
    #resolveStatus(feat) {
        const { signalType, networkId } = feat.p;
        const refTag = isSupported(signalType) ? getSignalId(signalType) : null;
        if (!refTag || !networkId) return _makeStatus(OSM_STATUS.UNSUPPORTED);
        const key = getIdKey({ refTag, networkId });
        if (_inOsmCache.has(key)) return _makeStatus(OSM_STATUS.IN_OSM, _inOsmCache.get(key));
        const entry = _getOsmEntry(networkId, key);
        if (entry !== null) return _makeStatus(OSM_STATUS.IN_OSM, entry);
        if (this.#notInOsmKeys.has(key)) return _makeStatus(OSM_STATUS.NOT_IN_OSM);
        if (this.#erroredKeys.has(key)) return _makeStatus(OSM_STATUS.ERROR);
        return _makeStatus(OSM_STATUS.CHECKING);
    }

    /**
     * Generate a micro-bbox centered on the current signal group coordinates.
     * Used to restrict Overpass queries instead of fetching the whole viewport.
     * @returns {string|null} "S,W,N,E" format or null if no features exist.
     */
    #getSignalBbox() {
        if (!this.#feats || this.#feats.length === 0) return null;
        // Co-located signals share the same coordinates; use the first one.
        const lat = this.#feats[0].lat;
        const lng = this.#feats[0].lng;
        const d = BBOX_HALF_DELTA_DEG;
        return `${lat - d},${lng - d},${lat + d},${lng + d}`;
    }

    async #attemptCheck() {
        const { toFetch, entries } = this.#prepareFetchList();
        if (toFetch.length > 0) {
            await this.#fetchAndUpdateCaches(toFetch, entries);
        }
        this.#rebuildStatuses();
        this.#notify();
        this.#scheduleRetryIfNeeded();
    }

    /**
     * Build the list of signals to query.
     * Excludes unsupported signals and those already resolved for this instance.
     */
    #prepareFetchList() {
        const toFetch = [];
        const entries = [];
        for (const f of this.#feats) {
            const { signalType, networkId } = f.p;
            const refTag = isSupported(signalType) ? getSignalId(signalType) : null;
            if (!refTag || !networkId) continue;
            const queryObj = { refTag, networkId };
            const key = getIdKey(queryObj);
            if (_inOsmCache.has(key) || this.#notInOsmKeys.has(key)) continue;
            toFetch.push(queryObj);
            entries.push({ key, networkId });
        }
        return { toFetch, entries };
    }

    /**
     * Execute the Overpass batch request and update both caches.
     * Confirmed IN_OSM results are also fed into the app-wide index via primeFromPopup.
     * On error, marks affected keys for retry scheduling.
     */
    async #fetchAndUpdateCaches(toFetch, entries) {
        try {
            const bbox = this.#getSignalBbox();
            const results = await fetchNodesByRef(toFetch, bbox, this.#abortController?.signal);

            for (const { key, networkId } of entries) {
                const entry = results.get(key);
                if (entry) {
                    _inOsmCache.set(key, entry);
                    primeFromPopup(networkId, entry);
                    this.#erroredKeys.delete(key);
                } else {
                    this.#notInOsmKeys.add(key);
                    this.#erroredKeys.delete(key);
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return; // Request cancelled intentionally, ignore.
            console.warn('[osm-checker] batch failed:', err.message);
            for (const { key } of entries) this.#erroredKeys.add(key);
        }
    }

    /** Recompute all statuses from current cache state. */
    #rebuildStatuses() {
        this.#statuses = this.#feats.map(f => this.#resolveStatus(f));
    }

    #scheduleRetryIfNeeded() {
        if (this.#retryCount >= MAX_RETRIES) return;
        if (!this.#statuses.some(s => this.#isError(s))) return;

        this.#retryCount++;
        this.#retryTimer = setTimeout(() => this.#attemptCheck(), RETRY_DELAY);
    }

    #clearRetryTimer() {
        if (this.#retryTimer) {
            clearTimeout(this.#retryTimer);
            this.#retryTimer = null;
        }
    }

    #notify() {
        this.#onStatusChange?.();
    }
}

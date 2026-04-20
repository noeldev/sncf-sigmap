/**
 * osm-checker.js — OSM existence state machine with caching and automatic retry.
 *
 * Manages the lifecycle of checking whether a group of co-located signals
 * already exists in OpenStreetMap. Delegates network requests to overpass.js
 * and notifies the caller of state changes via a callback.
 *
 * Cache strategy:
 *   - IN_OSM results are cached permanently for the session.
 *   - NOT_IN_OSM results are cached for the lifetime of the current popup instance.
 *   - ERROR results are never cached; they trigger automatic retries.
 *   - Unsupported signals (no OSM mapping) are never sent to Overpass.
 *   - Batch requests exclude signals already known for this instance.
 *
 * Public API (instance):
 *   check()       — start or restart the Overpass check
 *   retry()       — force a fresh check (clears NOT_IN_OSM instance cache)
 *   invalidate()  — alias for retry(); call after a successful JOSM/copy export
 *   abort()       — stop retries when the popup closes
 *   isChecking(idx) / isInOsm(idx) / isNotInOsm(idx) / isUnsupported(idx) / isError(idx)
 *   nodeIdAt(idx) / hasAnyInOsm()
 */

import { getIdKey, fetchNodesByRef } from './overpass.js';
import { getSignalId, isSupported } from './signal-mapping.js';

// ===== OSM status constants =====

const OSM_STATUS = {
    CHECKING: 'checking',
    IN_OSM: 'in-osm',
    NOT_IN_OSM: 'not-in-osm',
    UNSUPPORTED: 'unsupported',
    ERROR: 'error',
};

const _makeStatus = (status, nodeId = null) => ({ status, nodeId });

const MAX_RETRIES = 5;
const RETRY_DELAY = 10; // seconds

/** Permanent session-level cache: signals known to be IN_OSM never need rechecking. */
const _inOsmCache = new Map();


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

    /**
     * @param {object[]} feats           Normalized signal features to check.
     * @param {Function} onStatusChange  Called whenever state changes.
     */
    constructor(feats, onStatusChange) {
        this.#feats = feats;
        this.#onStatusChange = onStatusChange;
        // Initialise from session cache so IN_OSM signals display immediately.
        this.#statuses = feats.map(f => this.#resolveStatus(f));
    }


    // ===== Public API =====

    /** Start or restart the Overpass check. */
    async check() {
        this.#clearRetryTimer();
        this.#retryCount = 0;
        if (this.#statuses.some(s => this.#isError(s))) {
            this.#statuses = this.#statuses.map(s =>
                this.#isError(s) ? _makeStatus(OSM_STATUS.CHECKING) : s
            );
            this.#notify();
        }
        await this.#attemptCheck();
    }

    /** Force a fresh check, clearing the instance NOT_IN_OSM cache. */
    retry() {
        this.#notInOsmKeys.clear();
        this.#erroredKeys.clear();
        this.check();
    }

    /** Alias for retry() — call after a successful copy or JOSM export. */
    invalidate() { this.retry(); }

    /** Stop any pending retry timers when the popup closes. */
    abort() {
        this.#clearRetryTimer();
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

    /** True when any signal in this group has been found in OSM. */
    hasAnyInOsm() { return this.#statuses.some(s => this.#isInOsm(s)); }


    // ===== Private status predicates =====

    #isChecking(s) { return s.status === OSM_STATUS.CHECKING; }
    #isInOsm(s) { return s.status === OSM_STATUS.IN_OSM; }
    #isNotInOsm(s) { return s.status === OSM_STATUS.NOT_IN_OSM; }
    #isUnsupported(s) { return s.status === OSM_STATUS.UNSUPPORTED; }
    #isError(s) { return s.status === OSM_STATUS.ERROR; }


    // ===== Private helpers =====

    /**
     * Determine the current status for one signal feature.
     * Consults the session cache and instance caches.
     */
    #resolveStatus(feat) {
        const { signalType, networkId } = feat.p;
        const refTag = isSupported(signalType) ? getSignalId(signalType) : null;
        if (!refTag || !networkId) return _makeStatus(OSM_STATUS.UNSUPPORTED);
        const key = getIdKey({ refTag, networkId });
        if (_inOsmCache.has(key)) return _makeStatus(OSM_STATUS.IN_OSM, _inOsmCache.get(key));
        if (this.#notInOsmKeys.has(key)) return _makeStatus(OSM_STATUS.NOT_IN_OSM);
        if (this.#erroredKeys.has(key)) return _makeStatus(OSM_STATUS.ERROR);
        return _makeStatus(OSM_STATUS.CHECKING);
    }

    async #attemptCheck() {
        const { toFetch, entries } = this.#prepareFetchList();
        if (toFetch.length > 0) await this.#fetchAndUpdateCaches(toFetch, entries);
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
            entries.push({ key });
        }
        return { toFetch, entries };
    }

    /**
     * Execute the Overpass batch request and update both caches.
     * On error, marks affected keys for retry scheduling.
     */
    async #fetchAndUpdateCaches(toFetch, entries) {
        try {
            const results = await fetchNodesByRef(toFetch);
            for (const { key } of entries) {
                const nodeId = results.get(key);
                if (nodeId) {
                    _inOsmCache.set(key, nodeId);
                    this.#erroredKeys.delete(key);
                } else {
                    this.#notInOsmKeys.add(key);
                    this.#erroredKeys.delete(key);
                }
            }
        } catch (err) {
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
        this.#retryTimer = setTimeout(() => this.#attemptCheck(), RETRY_DELAY * 1000);
    }

    #clearRetryTimer() {
        if (this.#retryTimer) { clearTimeout(this.#retryTimer); this.#retryTimer = null; }
    }

    #notify() { this.#onStatusChange?.(); }
}

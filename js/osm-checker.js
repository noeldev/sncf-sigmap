/**
 * osm-checker.js — OSM existence state machine with caching and automatic retry.
 *
 * Manages the lifecycle of checking whether a group of co-located signals
 * already exists in OpenStreetMap. Delegates network requests to overpass.js
 * and notifies the caller of state changes via a callback.
 *
 * Cache strategy:
 *   - IN_OSM results are cached permanently for the session: a signal that
 *     exists in OSM will not disappear during the user's session.
 *   - NOT_IN_OSM results are cached for the lifetime of the current popup
 *     instance: closing and reopening the popup triggers a fresh check.
 *   - ERROR results are never cached; they trigger automatic retries at a
 *     fixed 30-second interval (up to MAX_RETRIES times).
 *   - Unsupported signals (no OSM mapping) are never sent to Overpass.
 *   - Batch requests exclude signals already known to be IN_OSM or NOT_IN_OSM
 *     for this instance, minimising server load.
 *
 * Public API (instance):
 *   check()       — start or restart the Overpass check
 *   retry()       — force a fresh check (clears NOT_IN_OSM instance cache)
 *   invalidate()  — alias for retry(); call after a successful JOSM/copy export
 *   abort()       — stop retries when the popup closes
 */

import { getIdKey, fetchNodesByRef } from './overpass.js';
import { getSignalId, isSupported } from './signal-mapping.js';

// ===== OSM status constants =====

const OSM_STATUS = {
    CHECKING:    'checking',
    IN_OSM:      'in-osm',
    NOT_IN_OSM:  'not-in-osm',
    UNSUPPORTED: 'unsupported',
    ERROR:       'error',
};

const _makeStatus = (status, nodeId = null) => ({ status, nodeId });

// Retry configuration on errors (network/gateway failures).
const MAX_RETRIES = 5;
const RETRY_DELAY = 10;

// Permanent session-level cache: signals known to be IN_OSM never need rechecking.
// key "${refTag}:${networkId}" → nodeId (number)
const _inOsmCache = new Map();

// ===== Public API (class) =====

export class OsmStatusChecker {
    /**
     * @param {object[]} feats           Normalized signal features to check.
     * @param {Function} onStatusChange  Called with the updated statuses array
     *                                   whenever state changes.
     */
    constructor(feats, onStatusChange) {
        this._feats = feats;
        this._onStatusChange = onStatusChange;
        this._retryCount = 0;
        this._retryTimer = null;

        // Instance-level cache: keys known NOT_IN_OSM for the current popup open.
        this._notInOsmKeys = new Set();
        // Instance-level error tracking: keys whose last fetch failed.
        this._erroredKeys = new Set();

        // Initialise from session cache so IN_OSM signals show immediately
        // without waiting for the first Overpass response.
        this.statuses = feats.map(f => this._resolveStatus(f));
    }

    /**
     * Start the Overpass check.
     * Resets ERROR statuses to CHECKING and triggers a batch request.
     */
    async check() {
        this._clearRetryTimer();
        this._retryCount = 0;

        const hasErrors = this.statuses.some(s => this._isError(s));
        if (hasErrors) {
            this.statuses = this.statuses.map(s =>
                this._isError(s) ? _makeStatus(OSM_STATUS.CHECKING) : s
            );
            this._notify();
        }
        await this._attemptCheck();
    }

    /**
     * Force a fresh check, clearing the instance NOT_IN_OSM cache.
     * Call from the retry button in the popup.
     */
    retry() {
        this._notInOsmKeys.clear();
        this._erroredKeys.clear();
        this.check();
    }

    /**
     * Alias for retry() — call after a successful copy or JOSM export so that
     * the signal, if it was NOT_IN_OSM, gets rechecked on the next attempt.
     */
    invalidate() {
        this.retry();
    }

    /**
     * Stop any pending retry timers when the popup closes.
     * In-flight requests are allowed to complete — if the signal is found IN_OSM
     * the result is stored in the session cache for the next popup open.
     */
    abort() {
        this._clearRetryTimer();
        this._onStatusChange = null;
    }

    // ===== Status query methods =====

    /** True when the signal at index idx is being checked. */
    isChecking(idx) { return this._isChecking(this.statuses[idx]); }
    /** True when the signal at index idx is confirmed present in OSM. */
    isInOsm(idx) { return this._isInOsm(this.statuses[idx]); }
    /** True when the signal at index idx is confirmed absent from OSM. */
    isNotInOsm(idx) { return this._isNotInOsm(this.statuses[idx]); }
    /** True when the signal at index idx has no OSM mapping (type not supported). */
    isUnsupported(idx) { return this._isUnsupported(this.statuses[idx]); }
    /** True when the last Overpass request for the signal at index idx failed. */
    isError(idx) { return this._isError(this.statuses[idx]); }
    /** OSM node ID for the signal at index idx, or null when not in OSM. */
    nodeIdAt(idx) { return this.statuses[idx]?.nodeId ?? null; }
    /** True when any signal in this group has been found in OSM. */
    hasAnyInOsm() { return this.statuses.some(s => this._isInOsm(s)); }

    // ===== Private predicates =====

    _isChecking(s) { return s.status === OSM_STATUS.CHECKING; }
    _isInOsm(s) { return s.status === OSM_STATUS.IN_OSM; }
    _isNotInOsm(s) { return s.status === OSM_STATUS.NOT_IN_OSM; }
    _isUnsupported(s) { return s.status === OSM_STATUS.UNSUPPORTED; }
    _isError(s) { return s.status === OSM_STATUS.ERROR; }

    // ===== Private helpers =====

    /**
     * Determine the current status for a single signal feature.
     * Consults the session cache and instance caches (NOT_IN_OSM, ERROR).
     */
    _resolveStatus(feat) {
        const { signalType, networkId } = feat.p;

        const refTag = isSupported(signalType) ? getSignalId(signalType) : null;
        if (!refTag || !networkId) return _makeStatus(OSM_STATUS.UNSUPPORTED);

        const key = getIdKey({ refTag, networkId });

        if (_inOsmCache.has(key)) return _makeStatus(OSM_STATUS.IN_OSM, _inOsmCache.get(key));
        if (this._notInOsmKeys.has(key)) return _makeStatus(OSM_STATUS.NOT_IN_OSM);
        if (this._erroredKeys.has(key)) return _makeStatus(OSM_STATUS.ERROR);

        return _makeStatus(OSM_STATUS.CHECKING);
    }

    async _attemptCheck() {
        const { toFetch, entries } = this._prepareFetchList();

        if (toFetch.length > 0) {
            await this._fetchAndUpdateCaches(toFetch, entries);
        }

        this._rebuildStatuses();
        this._notify();
        this._scheduleRetryIfNeeded();
    }

    /**
     * Build the list of signals to query.
     * Excludes unsupported signals, those already IN_OSM (session cache),
     * and those already NOT_IN_OSM for this popup instance.
     *
     * @returns {{ toFetch: Array, entries: Array<{ key: string }> }}
     */
    _prepareFetchList() {
        const toFetch = [];
        const entries = [];

        for (const f of this._feats) {
            const { signalType, networkId } = f.p;

            const refTag = isSupported(signalType) ? getSignalId(signalType) : null;
            if (!refTag || !networkId) continue;

            const queryObj = { refTag, networkId };
            const key = getIdKey(queryObj);
            if (_inOsmCache.has(key) || this._notInOsmKeys.has(key)) continue;

            toFetch.push(queryObj);
            entries.push({ key });
        }

        return { toFetch, entries };
    }

    /**
     * Execute the Overpass batch request and update both caches.
     * On network error, marks affected keys as errored (for retry scheduling).
     */
    async _fetchAndUpdateCaches(toFetch, entries) {
        try {
            const results = await fetchNodesByRef(toFetch);

            for (const { key } of entries) {
                const nodeId = results.get(key);
                if (nodeId) {
                    _inOsmCache.set(key, nodeId);  // permanent session cache
                    this._erroredKeys.delete(key);
                } else {
                    this._notInOsmKeys.add(key);   // instance cache
                    this._erroredKeys.delete(key);
                }
            }
        } catch (err) {
            console.warn('[osm-checker] batch failed:', err.message);
            for (const { key } of entries) {
                this._erroredKeys.add(key);
            }
        }
    }

    /**
     * Recompute this.statuses from the session cache, instance caches, and
     * error tracking — one pass over all feats.
     */
    _rebuildStatuses() {
        this.statuses = this._feats.map(f => this._resolveStatus(f));
    }

    /** Schedule a retry if any ERROR status remains and retries are not exhausted. */
    _scheduleRetryIfNeeded() {
        if (this._retryCount >= MAX_RETRIES) return;
        if (!this.statuses.some(s => this._isError(s))) return;

        this._retryCount++;
        this._retryTimer = setTimeout(() => this._attemptCheck(), RETRY_DELAY * 1000);
    }

    _clearRetryTimer() {
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
    }

    _notify() {
        this._onStatusChange?.();
    }
}
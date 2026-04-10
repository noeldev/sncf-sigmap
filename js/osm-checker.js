/**
 * osm-checker.js — OSM existence status state machine.
 *
 * Manages the lifecycle of checking whether a group of co-located signals
 * already exists in OpenStreetMap. Delegates network requests to overpass.js
 * and notifies the caller of state changes via a callback.
 *
 * This module has no DOM dependencies. It follows the same pattern as
 * Dropdown, ComboBox, and PillList: a pure logic component that communicates
 * via injected callbacks, leaving all DOM manipulation to the caller.
 *
 * Public API (instance):
 *   check(force?)   — start or restart the Overpass check
 *   retry()         — force a fresh check (ignores cache)
 *   invalidate()    — clear cached 'not-in-osm' results (call after export)
 *   abort()         — cancel any in-flight request (call when popup closes)
 */

import { checkSignalGroup, invalidateSignalGroup } from './overpass.js';
import { isSupported } from './signal-mapping.js';


export class OsmStatusChecker {
    /**
     * @param {object[]}  feats           Normalized signal features to check.
     * @param {Function}  onStatusChange  Called with the updated statuses array
     *                                    whenever state changes.
     */
    constructor(feats, onStatusChange) {
        this._feats = feats;
        this._onStatusChange = onStatusChange;

        // Set initial statuses synchronously so the popup can render
        // the correct initial state before the first Overpass response.
        this.statuses = feats.map(f =>
            isSupported(f.p.signalType)
                ? { status: 'checking', nodeId: null }
                : { status: 'unsupported', nodeId: null }
        );
    }

    /**
     * Start (or restart) the Overpass check.
     * Resets any 'error' statuses back to 'checking' and notifies immediately
     * so the UI shows a spinner while the request is in flight.
     *
     * @param {boolean} [force=false]  When true, ignores cached results.
     */
    async check(force = false) {
        // Reset error entries to 'checking' before the new request.
        this.statuses = this.statuses.map(s =>
            s.status === 'error' ? { status: 'checking', nodeId: null } : s
        );
        this._notify();

        const results = await checkSignalGroup(this._feats, force);
        this.statuses = results;
        this._notify();
    }

    /**
     * Force a fresh Overpass check, bypassing the cache.
     * Convenience wrapper over check(true) — wired to the retry button.
     */
    retry() {
        this.check(true);
    }

    /**
     * Invalidate cached 'not-in-osm' entries for these signals.
     * Call after a successful copy or JOSM export so the next popup
     * open triggers a fresh Overpass check.
     */
    invalidate() {
        invalidateSignalGroup(this._feats);
    }

    /**
     * Cancel any in-flight Overpass request.
     * Call when the popup closes to avoid stale state updates.
     * overpass.js aborts via its own AbortController on the next checkSignalGroup call;
     * we simply stop caring about the previous result by nulling the callback.
     */
    abort() {
        // Suppress any pending callback by detaching the notifier.
        // overpass.js will abort internally when the next request starts.
        this._onStatusChange = null;
    }


    // ===== Private =====

    _notify() {
        this._onStatusChange?.(this.statuses);
    }
}

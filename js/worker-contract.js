/**
 * worker-contract.js — Shared message contract for geojson.worker.js.
 *
 * Centralises the worker identity token and message helpers so that both
 * the worker and the main thread always agree on the message shape.
 *
 * Worker side  → use workerPost.*  (replaces bare self.postMessage calls)
 * Main thread  → use isOwnWorkerMessage() to guard worker.onmessage
 *
 * All outgoing messages carry { source: WORKER_SOURCE } automatically,
 * making them unambiguously distinguishable from browser-extension noise.
 */

/** @type {string} Unique token stamped on every message sent by our worker. */
export const WORKER_SOURCE = 'geojson-worker';

/**
 * Returns true when a MessageEvent originates from our own worker.
 * Any message lacking the correct source token is silently ignored.
 *
 * @param {MessageEvent} e
 * @returns {boolean}
 */
export function isOwnWorkerMessage(e) {
    return e?.data?.source === WORKER_SOURCE;
}

/**
 * Typed outgoing-message helpers for use inside geojson.worker.js.
 * Each method forwards to self.postMessage() with source pre-filled.
 *
 * Usage (worker side):
 *   import { workerPost } from './worker-contract.js';
 *   workerPost.progress('Loading 3 tile(s)…');
 *   workerPost.done(groups, true, totalGroups);
 *   workerPost.error('Something went wrong');
 */
export const workerPost = {
    /**
     * @param {string} msg  Human-readable progress label shown in the UI.
     */
    progress(msg) {
        self.postMessage({ source: WORKER_SOURCE, status: 'progress', msg });
    },

    /**
     * @param {Array}   groups  Processed signal groups ({ lat, lng, all, display }).
     * @param {boolean} sampled Whether spatial sampling was applied.
     * @param {number}  total   Total group count before sampling.
     */
    done(groups, sampled, total) {
        self.postMessage({ source: WORKER_SOURCE, status: 'done', groups, sampled, total });
    },

    /**
     * @param {string} error  Error message forwarded to the main thread console.
     */
    error(error) {
        self.postMessage({ source: WORKER_SOURCE, status: 'error', error });
    },
};

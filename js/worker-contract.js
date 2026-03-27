/**
 * worker-contract.js — Shared message contract for tiles.worker.js.
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
export const WORKER_SOURCE = 'tiles-worker';

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
 * Typed outgoing-message helpers for use inside tiles.worker.js.
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
     * @param {string}    key   Translation key (e.g. 'progress.tiles').
     * @param {...*}      args  Substitution arguments forwarded to t() on the main thread.
     */
    progress(key, ...args) {
        self.postMessage({ source: WORKER_SOURCE, status: 'progress', key, args });
    },

    /**
     * @param {Array}   groups  Partial signal groups ready to render incrementally.
     * @param {number}  loaded  Number of tiles loaded so far.
     * @param {number}  total   Total number of tiles in this fetch batch.
     */
    partial(groups, loaded, total) {
        self.postMessage({ source: WORKER_SOURCE, status: 'partial', groups, loaded, total });
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

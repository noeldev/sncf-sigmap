// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * overpass-scheduler.js - Global concurrency gate for Overpass network calls.
 *
 * Every Overpass request funnels through overpass.js, which routes the actual
 * fetch through schedule() here. The gate guarantees the app never opens more
 * than MAX_CONCURRENT connections to the proxy at once: extra requests wait in
 * a queue and start as slots free up. This keeps traffic looking interactive
 * rather than programmatic (the shape the anti-scraper filter reacts to) and
 * bounds the number of concurrent serverless proxy invocations.
 *
 * It does NOT reduce the total number of requests - caching in osm-index.js and
 * osm-checker.js does that. It only caps how many run in parallel.
 *
 * Abort handling is transparent: the AbortSignal is carried by the task's own
 * fetch, not by this module. A task whose signal is already aborted when it
 * reaches the front of the queue rejects immediately without hitting the
 * network, so cancelled work never costs an invocation.
 *
 * Public API:
 *   schedule(task) - run an async task under the global concurrency limit
 */

// ===== Configuration =====

// Two in-flight requests is enough to keep a viewport scan and a popup check
// progressing together without ever bursting.
const MAX_CONCURRENT = 2;

// ===== State =====

let _active = 0;

/** @type {Array<{ task: Function, resolve: Function, reject: Function }>} */
const _queue = [];

// ===== Public API =====

/**
 * Run an async task under the global concurrency limit.
 * The slot is always released, including on rejection, so the queue never stalls.
 *
 * @template T
 * @param {() => Promise<T>} task - Function returning the promise to run (typically a fetch).
 * @returns {Promise<T>}
 */
export function schedule(task) {
    return new Promise((resolve, reject) => {
        _queue.push({ task, resolve, reject });
        _pump();
    });
}

// ===== Private helpers =====

/** Start queued tasks until every concurrency slot is busy. */
function _pump() {
    while (_active < MAX_CONCURRENT && _queue.length > 0) {
        const { task, resolve, reject } = _queue.shift();
        _active++;
        Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
                _active--;
                _pump();
            });
    }
}

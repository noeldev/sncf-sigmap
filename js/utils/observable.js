/**
 * utils/observable.js — Minimal observer pattern for subscription fan-out.
 *
 * Used by translation.js (onLangChange) and pins.js (onPinsChange) to
 * broadcast a single event type to any number of interested listeners.
 *
 * Public API:
 *   subscribe(fn)   → unsubscribe function
 *   notify(...args) → calls every subscriber with the given args
 */
export class Observable {
    #listeners = new Set();

    subscribe(fn) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    notify(...args) {
        this.#listeners.forEach(fn => fn(...args));
    }
}
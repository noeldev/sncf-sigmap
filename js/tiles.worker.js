/**
 * tiles.worker.js — Fetch, normalize and filter tile data off the main thread.
 *
 * Incoming message:
 *   { type, urls, activeFilters, bounds, maxSignals }
 *
 * Outgoing messages (via workerPost — see worker-contract.js):
 *   { source, status: 'partial', groups, loaded, total }  — detail mode only
 *   { source, status: 'progress', msg }
 *   { source, status: 'done', groups, sampled, total }
 *   { source, status: 'error', error }
 *
 * Overview mode (maxSignals set):
 *   All tiles are fetched in parallel with Promise.all, then filtered and
 *   spatially sampled before a single 'done' message is sent.
 *   This keeps the overview stable.
 *
 * Detail mode (maxSignals null):
 *   Tiles are fetched sequentially. A 'partial' message is sent after each
 *   tile so the map updates progressively as data arrives.
 *
 * Each group represents one geographic location:
 *   { lat, lng, all: Signal[], display: Signal[] }
 *
 *   all     — every signal at that location, regardless of active filters.
 *   display — the subset that passes the active filters.
 *
 * A group is included only when display.length > 0.
 */

import { workerPost } from './worker-contract.js';
import { normalizeSignal } from './sncf-convert.js';
import { fetchTile } from './tiles.js';

self.onmessage = async function (e) {
    const { type, urls, activeFilters, bounds, maxSignals } = e.data;
    if (type !== 'fetch-tiles') {
        workerPost.error(`Unknown message type: ${type}`);
        return;
    }

    try {
        const filterSets = _buildFilterSets(activeFilters);

        if (maxSignals) {
            // Overview mode
            workerPost.progress('progress.tiles', urls.length);
            const tiles = await Promise.all(urls.map(fetchTile));
            workerPost.progress('progress.filtering');
            const byKey = _groupByLocation(tiles, bounds);
            const groups = _buildGroups(byKey, filterSets);
            const total = groups.length;
            if (total > maxSignals) {
                workerPost.done(_spatialSampleGroups(groups, maxSignals), true, total);
            } else {
                workerPost.done(groups, false, total);
            }
        } else {
            // Detail mode — sequential fetch with incremental partial renders.
            const byKey = new Map();
            const count = urls.length;
            for (let i = 0; i < count; i++) {
                const tile = await fetchTile(urls[i]);
                const newGroups = _mergeTile(tile, byKey, bounds, filterSets);
                workerPost.progress('progress.tiles', `${i + 1} / ${count}`);
                if (newGroups.length > 0) workerPost.partial(newGroups, i + 1, count);
            }
            const groups = _buildGroups(byKey, filterSets);
            workerPost.done(groups, false, groups.length);
        }

    } catch (err) {
        workerPost.error(err.message);
    }
};

/* ===== Private helpers ===== */

/** Convert activeFilters arrays to Sets for O(1) lookups. */
function _buildFilterSets(activeFilters) {
    const sets = {};
    for (const [field, vals] of Object.entries(activeFilters)) {
        if (Array.isArray(vals) && vals.length > 0) sets[field] = new Set(vals);
    }
    return sets;
}

/**
 * Group all in-bounds signals from a set of tiles by location key.
 * Used by overview mode which receives all tiles at once.
 */
function _groupByLocation(tiles, bounds) {
    const { swLat, swLng, neLat, neLng } = bounds;
    const byKey = new Map();
    for (const tile of tiles) {
        if (!Array.isArray(tile)) continue;
        for (const s of tile) {
            if (s.lat < swLat || s.lat > neLat || s.lng < swLng || s.lng > neLng) continue;
            const p = normalizeSignal(s);
            const key = _groupKey(p, s);
            if (!byKey.has(key)) byKey.set(key, { lat: s.lat, lng: s.lng, all: [] });
            byKey.get(key).all.push({ lat: s.lat, lng: s.lng, p });
        }
    }
    return byKey;
}

/**
 * Merge one tile into the cumulative byKey Map.
 * Returns only the groups that were new or modified by this tile.
 * Used by detail mode for incremental rendering.
 */
function _mergeTile(tile, byKey, bounds, filterSets) {
    if (!Array.isArray(tile)) return [];
    const { swLat, swLng, neLat, neLng } = bounds;
    const hasFilters = Object.keys(filterSets).length > 0;
    const touched = new Set();

    for (const s of tile) {
        if (s.lat < swLat || s.lat > neLat || s.lng < swLng || s.lng > neLng) continue;
        const p = normalizeSignal(s);
        const key = _groupKey(p, s);
        if (!byKey.has(key)) byKey.set(key, { lat: s.lat, lng: s.lng, all: [] });
        byKey.get(key).all.push({ lat: s.lat, lng: s.lng, p });
        touched.add(key);
    }

    const newGroups = [];
    for (const key of touched) {
        const { lat, lng, all } = byKey.get(key);
        const display = hasFilters ? all.filter(s => _matches(s.p, filterSets)) : all;
        if (display.length > 0) newGroups.push({ lat, lng, all, display });
    }
    return newGroups;
}

/** Build the final group list from a completed byKey Map. */
function _buildGroups(byKey, filterSets) {
    const hasFilters = Object.keys(filterSets).length > 0;
    const groups = [];
    for (const { lat, lng, all } of byKey.values()) {
        const display = hasFilters ? all.filter(s => _matches(s.p, filterSets)) : all;
        if (display.length > 0) groups.push({ lat, lng, all, display });
    }
    return groups;
}

// Field normalization is handled by normalizeSignal() from sncf-convert.js.

/** Derive the location key used to group co-located signals. */
function _groupKey(p, s) {
    return (p.trackCode && p.milepost)
        ? `${p.trackCode}|${p.milepost}`
        : `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
}

/**
 * Spatial grid subsampling — original two-phase algorithm.
 * First-encountered group per cell preserves natural size diversity.
 */
function _spatialSampleGroups(groups, maxCount) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const g of groups) {
        if (g.lat < minLat) minLat = g.lat;
        if (g.lat > maxLat) maxLat = g.lat;
        if (g.lng < minLng) minLng = g.lng;
        if (g.lng > maxLng) maxLng = g.lng;
    }

    const latRange = maxLat - minLat || 1;
    const lngRange = maxLng - minLng || 1;

    function _gridSample(source, gridSize) {
        const cells = new Map();
        for (const g of source) {
            const cx = Math.min(Math.floor(((g.lng - minLng) / lngRange) * gridSize), gridSize - 1);
            const cy = Math.min(Math.floor(((g.lat - minLat) / latRange) * gridSize), gridSize - 1);
            const k = cy * gridSize + cx;
            if (!cells.has(k)) cells.set(k, g);   // first-encountered → natural size diversity
        }
        return [...cells.values()];
    }

    const phase1 = _gridSample(groups, Math.ceil(Math.sqrt(maxCount * 2)));
    if (phase1.length <= maxCount) return phase1;
    return _gridSample(phase1, Math.ceil(Math.sqrt(maxCount)));
}

/** Returns true when signal properties satisfy all active filters. */
function _matches(p, filterSets) {
    for (const field in filterSets) {
        if (!filterSets[field].has(String(p[field] ?? ''))) return false;
    }
    return true;
}

/**
 * tiles-worker.js — Fetch, normalize and filter tile data off the main thread.
 *
 * Incoming message:
 *   { type, urls, activeFilters, bounds, forceOverview }
 *
 * Outgoing messages (via workerPost — see worker-contract.js):
 *   { source, status: 'partial', groups, loaded, total }  — detail mode only
 *   { source, status: 'progress', key, args }
 *   { source, status: 'done', groups, sampled, total }
 *   { source, status: 'error', error }
 *
 * Loading strategy (forceOverview flag):
 *   forceOverview = true  → parallel tile fetch, single 'done' at end.
 *   forceOverview = false → sequential tile fetch, incremental 'partial' updates.
 *
 * Sampling strategy (independent of loading strategy):
 *   Triggered when the total number of *marker groups* after filtering exceeds
 *   OVERVIEW_MAX_SIGNALS. A marker group = one Leaflet marker at a given location;
 *   it may contain several co-located signals. The cap therefore applies to the
 *   count of DOM nodes rendered, not to the number of raw signals in the data.
 *
 *   When sampling is triggered, _capGroups() is used:
 *     - If the excess is small (≤ 50% above the cap), a direct truncation
 *       sorted by group size (descending) is used. This preserves the most
 *       informative markers and avoids the over-aggressive grid collisions that
 *       _spatialSampleGroups produces on a narrow viewport.
 *     - Otherwise, _spatialSampleGroups() provides a spatially representative
 *       sample (designed for the overview of all France).
 *
 * Each group represents one geographic location:
 *   { lat, lng, all: Signal[], display: Signal[] }
 *
 *   all     — every signal at that location, regardless of active filters.
 *   display — the subset that passes the active filters.
 *
 * A group is included only when display.length > 0.
 */

import { OVERVIEW_MAX_SIGNALS } from './config.js';
import { workerPost } from './tiles-worker-contract.js';
import { normalizeSignal } from './sncf-convert.js';
import { fetchTile } from './tiles.js';


self.onmessage = async function (e) {
    const { type, urls, activeFilters, bounds, forceOverview } = e.data;
    if (type !== 'fetch-tiles') {
        workerPost.error(`Unknown message type: ${type}`);
        return;
    }

    try {
        const filterSets = _buildFilterSets(activeFilters);

        if (forceOverview) {
            await _runOverview(urls, bounds, filterSets);
        } else {
            await _runDetail(urls, bounds, filterSets);
        }
    } catch (err) {
        workerPost.error(err.message);
    }
};


// ===== Loading strategies =====

/**
 * Overview strategy: fetch all tiles in parallel, sample once at the end.
 * Used at low zoom where a stable, evenly distributed sample is more useful
 * than progressive rendering.
 */
async function _runOverview(urls, bounds, filterSets) {
    workerPost.progress('progress.tiles', urls.length);
    const tiles = await Promise.all(urls.map(fetchTile));
    workerPost.progress('progress.filtering');
    const byKey = _groupByLocation(tiles, bounds);
    const groups = _buildGroups(byKey, filterSets);
    const total = groups.length;
    if (total > OVERVIEW_MAX_SIGNALS) {
        workerPost.done(_capGroups(groups, OVERVIEW_MAX_SIGNALS), true, total);
    } else {
        workerPost.done(groups, false, total);
    }
}

/**
 * Detail strategy: fetch tiles sequentially and send incremental 'partial'
 * updates so markers appear progressively as data arrives.
 *
 * Two independent concerns — deliberately kept separate:
 *
 *   safetyTriggered — controls whether partial updates continue.
 *     Tracked via byKey.size (all in-bounds locations, before filtering).
 *     Conservative overestimate: stops partials early when the viewport is
 *     dense, even if many locations fail the active filters. Erring on the
 *     side of caution here is correct — we don't want to flood the main
 *     thread with partial renders that will be discarded anyway.
 *
 *   sampled (badge) — determined from the actual filtered group count at the
 *     very end. A filter (e.g. a single line code) may reduce the visible
 *     groups well below the cap even when the raw viewport is dense.
 *     Decoupling this from safetyTriggered avoids showing the badge when
 *     all visible groups fit within the cap — the root cause of the bug
 *     where "Signals: 95" was reported as sampled when no sampling occurred.
 */
async function _runDetail(urls, bounds, filterSets) {
    const byKey = new Map();
    const count = urls.length;
    let safetyTriggered = false;

    for (let i = 0; i < count; i++) {
        const tile = await fetchTile(urls[i]);
        const newGroups = _mergeTile(tile, byKey, bounds, filterSets);

        workerPost.progress('progress.tiles', `${i + 1} / ${count}`);

        if (safetyTriggered) continue;     // still loading but no more marker data

        if (byKey.size > OVERVIEW_MAX_SIGNALS) {
            safetyTriggered = true;        // stop partial updates from here
        } else if (newGroups.length > 0) {
            workerPost.partial(newGroups, i + 1, count);
        }
    }

    // Build the final display-filtered group list.
    const groups = _buildGroups(byKey, filterSets);
    const sampled = groups.length > OVERVIEW_MAX_SIGNALS;
    workerPost.done(
        sampled ? _capGroups(groups, OVERVIEW_MAX_SIGNALS) : groups,
        sampled,
        groups.length
    );
}


// ===== Sampling =====

/**
 * Reduce groups to at most maxCount while retaining the most visible markers.
 *
 * Two-strategy selector:
 *   - Small excess (total ≤ maxCount * 1.5): sort by group size descending
 *     and take the first maxCount. Preserves the most informative markers
 *     (multi-signal co-located groups) and avoids grid collisions that would
 *     produce far fewer results than maxCount on a narrow viewport (e.g. a
 *     dense urban area at zoom 12–14).
 *   - Large excess (total > maxCount * 1.5): spatial grid sampling for a
 *     geographically representative distribution. Designed for the overview
 *     case (all of France with 120k+ groups).
 *
 * @param {object[]} groups
 * @param {number}   maxCount
 * @returns {object[]}
 */
function _capGroups(groups, maxCount) {
    if (groups.length <= maxCount) return groups;

    if (groups.length <= maxCount * 1.5) {
        // Small excess — sort by descending display count, take first maxCount.
        // Stable sort: equal-size groups retain their original (geographic) order.
        return groups
            .slice()
            .sort((a, b) => b.display.length - a.display.length)
            .slice(0, maxCount);
    }

    // Large excess — spatial grid sample for a geographically uniform distribution.
    return _spatialSampleGroups(groups, maxCount);
}

/**
 * Spatial grid subsampling — original two-phase algorithm.
 * First-encountered group per cell preserves natural size diversity.
 * Effective for large datasets spread over a wide geographic area.
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


// ===== Private helpers =====

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
 * Returns only the display-filtered groups that were new or modified by this tile.
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

/** Derive the location key used to group co-located signals. */
function _groupKey(p, s) {
    return (p.trackCode && p.milepost)
        ? `${p.trackCode}|${p.milepost}`
        : `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
}

/** Returns true when signal properties satisfy all active filters. */
function _matches(p, filterSets) {
    for (const field in filterSets) {
        if (!filterSets[field].has(String(p[field] ?? ''))) return false;
    }
    return true;
}

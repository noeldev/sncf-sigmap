/**
 * geojson.worker.js — Fetch and filter tile data off the main thread.
 *
 * Incoming message:
 *   { type, urls, activeFilters, bounds, maxSignals }
 *
 * Outgoing messages:
 *   { status: 'progress', msg }
 *   { status: 'done', groups, sampled, total }
 *   { status: 'error', error }
 *
 * Each group represents one geographic location:
 *   { lat, lng, all: Signal[], display: Signal[] }
 *
 *   all     — every signal at that location within the viewport bounds,
 *             regardless of active filters. Used by the popup for JOSM export
 *             so that no signal is lost when a filter is active.
 *   display — the subset of `all` that passes the active filters.
 *             Used for the map marker and tooltip.
 *
 * A group is included in the result only when display.length > 0.
 *
 * Sampling (overview mode):
 *   _spatialSampleGroups() uses a viewport-relative grid scaled to the current
 *   set of matching groups, ensuring one representative group per grid cell for
 *   good geographic spread.  Panning may cause minor marker changes at tile
 *   boundaries; this is an acceptable trade-off for consistent visual coverage.
 */

self.onmessage = async function (e) {
    const { type, urls, activeFilters, bounds, maxSignals } = e.data;
    if (type !== 'fetch-tiles') {
        self.postMessage({ status: 'error', error: `Unknown message type: ${type}` });
        return;
    }

    try {
        self.postMessage({ status: 'progress', msg: `Loading ${urls.length} tile(s)…` });

        const tiles = await Promise.all(urls.map(_fetchTile));

        self.postMessage({ status: 'progress', msg: 'Filtering…' });

        const { swLat, swLng, neLat, neLng } = bounds;
        // Pre-convert filter value arrays to Sets for O(1) .has() lookups.
        // _matches() is called for every signal in every tile — the savings are
        // meaningful at 230 000+ records, especially with multiple active filters.
        const filterSets = {};
        for (const [field, vals] of Object.entries(activeFilters)) {
            if (Array.isArray(vals) && vals.length > 0) filterSets[field] = new Set(vals);
        }
        const hasFilters = Object.keys(filterSets).length > 0;

        // ---- Pass 1: group all in-bounds signals by location key ----
        const byKey = new Map();
        for (const tile of tiles) {
            if (!Array.isArray(tile)) continue;
            for (const s of tile) {
                if (s.lat < swLat || s.lat > neLat || s.lng < swLng || s.lng > neLng) continue;
                const p = {
                    type_if: s.type_if || '',
                    code_ligne: s.code_ligne || '',
                    nom_voie: s.nom_voie || '',
                    sens: s.sens || '',
                    position: s.position || '',
                    pk: s.pk || '',
                    idreseau: s.idreseau || '',
                    code_voie: s.code_voie || '',
                };
                const key = (p.code_voie && p.pk)
                    ? `${p.code_voie}|${p.pk}`
                    : `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
                if (!byKey.has(key)) byKey.set(key, { lat: s.lat, lng: s.lng, all: [] });
                byKey.get(key).all.push({ lat: s.lat, lng: s.lng, p });
            }
        }

        // ---- Pass 2: build display subset, keep groups with ≥1 visible signal ----
        const groups = [];
        for (const { lat, lng, all } of byKey.values()) {
            const display = hasFilters
                ? all.filter(s => _matches(s.p, filterSets))
                : all;
            if (display.length > 0) groups.push({ lat, lng, all, display });
        }

        // ---- Spatial sampling on groups ----
        const totalGroups = groups.length;
        if (maxSignals && totalGroups > maxSignals) {
            const sampled = _spatialSampleGroups(groups, maxSignals);
            self.postMessage({
                status: 'done',
                groups: sampled,
                sampled: true,
                total: totalGroups,
            });
            return;
        }

        self.postMessage({ status: 'done', groups, sampled: false, total: totalGroups });

    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
};

async function _fetchTile(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) {
            if (r.status !== 404) console.warn(`[Worker] ${url} → ${r.status}`);
            return [];
        }
        // Primary path: Content-Encoding: gzip handled automatically by fetch().
        const clone = r.clone();
        try {
            const d = await r.json();
            if (Array.isArray(d)) return d;
            // Tolerate a GeoJSON FeatureCollection if the tile format ever changes.
            if (d?.features && Array.isArray(d.features)) return d.features;
        } catch (_) { /* fallthrough to DecompressionStream */ }
        // Fallback: manual DecompressionStream for local dev servers.
        try {
            const body = clone.body.pipeThrough(new DecompressionStream('gzip'));
            return JSON.parse(await new Response(body).text());
        } catch (_) { /* fallthrough */ }
        return [];
    } catch (err) {
        console.warn('[Worker] fetch failed:', url, err.message);
        return [];
    }
}

/**
 * Spatial grid subsampling operating on groups.
 *
 * Phase 1 — fine grid (≈ 2×maxCount cells):
 *   Divide the bounding box into a grid and keep one group per cell.
 *   The first-encountered group in each cell is kept (insertion order from
 *   the tile fetch).  This preserves a natural mix of small and large groups,
 *   giving visual size diversity in overview mode.
 *
 * Phase 2 — coarser grid (≈ maxCount cells) applied to phase-1 survivors:
 *   If phase 1 still exceeds maxCount (many occupied cells), a second,
 *   coarser grid is applied to the survivors.  Using a grid rather than a
 *   stride index maintains geographic spread — stride can silently drop
 *   entire regions if they happen to fall on skipped indices.
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

    /** Keep the most signal-rich group per grid cell. */
    function _gridSample(source, gridSize) {
        const cells = new Map();
        for (const g of source) {
            const cx = Math.min(
                Math.floor(((g.lng - minLng) / lngRange) * gridSize), gridSize - 1
            );
            const cy = Math.min(
                Math.floor(((g.lat - minLat) / latRange) * gridSize), gridSize - 1
            );
            const k = cy * gridSize + cx;
            if (!cells.has(k)) cells.set(k, g);   // first-encountered → natural size diversity
        }
        return [...cells.values()];
    }

    // Phase 1: fine grid
    const phase1 = _gridSample(groups, Math.ceil(Math.sqrt(maxCount * 2)));
    if (phase1.length <= maxCount) return phase1;

    // Phase 2: coarser grid applied to phase-1 survivors
    return _gridSample(phase1, Math.ceil(Math.sqrt(maxCount)));
}

/**
 * Returns true when signal properties satisfy all active filters.
 * filterSets values are Sets (pre-converted from arrays) for O(1) .has() lookups.
 */
function _matches(p, filterSets) {
    for (const field in filterSets) {
        if (!filterSets[field].has(String(p[field] ?? ''))) return false;
    }
    return true;
}

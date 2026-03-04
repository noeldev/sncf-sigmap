/**
 * geojson.worker.js — Fetch and filter tile data off the main thread.
 *
 * Incoming message:
 *   { type, urls, activeFilters, bounds, maxSignals }
 *
 * Outgoing messages:
 *   { status: 'progress', msg }
 *   { status: 'done', signals, sampled, total }
 *   { status: 'error', error }
 *
 * Logic:
 *   - Active filters are ALWAYS applied regardless of zoom level.
 *   - If filters are active and the result fits within maxSignals, no sampling is done.
 *   - If no filters are active and maxSignals is set (overview mode), spatial sampling
 *     is applied to distribute results across the whole visible territory.
 */

self.onmessage = async function (e) {
    const { type, urls, activeFilters, bounds, maxSignals } = e.data;
    if (type !== 'fetch-tiles') {
        self.postMessage({ status: 'error', error: `Unknown message type: ${type}` }); return;
    }

    try {
        self.postMessage({ status: 'progress', msg: `Loading ${urls.length} tile(s)…` });

        const tiles = await Promise.all(urls.map(_fetchTile));

        self.postMessage({ status: 'progress', msg: 'Filtering…' });

        const { swLat, swLng, neLat, neLng } = bounds;
        const signals    = [];

        for (const tile of tiles) {
            if (!Array.isArray(tile)) continue;
            for (const s of tile) {
                if (s.lat < swLat || s.lat > neLat || s.lng < swLng || s.lng > neLng) continue;
                const p = {
                    type_if:    s.type_if    || '',
                    code_ligne: s.code_ligne || '',
                    nom_voie:   s.nom_voie   || '',
                    sens:       s.sens       || '',
                    position:   s.position   || '',
                    pk:         s.pk         || '',
                    idreseau:   s.idreseau   || '',
                    code_voie:  s.code_voie  || '',
                };
                if (!_matches(p, activeFilters)) continue;
                signals.push({ lat: s.lat, lng: s.lng, p });
            }
        }

        // Spatial sampling always applies when maxSignals is set and exceeded,
        // regardless of whether filters are active — this keeps the map readable
        // at low zoom even when a filter matches many signals.
        if (maxSignals && signals.length > maxSignals) {
            const sampled = _spatialSample(signals, maxSignals);
            self.postMessage({ status: 'done', signals: sampled, sampled: true, total: signals.length });
            return;
        }

        self.postMessage({ status: 'done', signals, sampled: false, total: signals.length });

    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
};

async function _fetchTile(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) { if (r.status !== 404) console.warn(`[Worker] ${url} → ${r.status}`); return []; }

        // Primary path: Content-Encoding: gzip set by netlify.toml — fetch().json() decompresses automatically
        const clone = r.clone();
        try { const d = await r.json(); if (Array.isArray(d)) return d; } catch (_) {}

        // Fallback: manual DecompressionStream for local development servers
        try {
            const body = clone.body.pipeThrough(new DecompressionStream('gzip'));
            return JSON.parse(await new Response(body).text());
        } catch (_) {}

        return [];
    } catch (err) {
        console.warn('[Worker] fetch failed:', url, err.message); return [];
    }
}

/**
 * Spatial grid subsampling.
 * Divides the bounding box into a grid, keeps the first signal per cell.
 * Full scan ensures geographic spread — no early exit that would bias toward one area.
 */
function _spatialSample(signals, maxCount) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const s of signals) {
        if (s.lat < minLat) minLat = s.lat;
        if (s.lat > maxLat) maxLat = s.lat;
        if (s.lng < minLng) minLng = s.lng;
        if (s.lng > maxLng) maxLng = s.lng;
    }

    const gridSize = Math.ceil(Math.sqrt(maxCount * 2));
    const latRange = maxLat - minLat || 1;
    const lngRange = maxLng - minLng || 1;
    const cells    = new Map();

    for (const s of signals) {
        const cx = Math.min(Math.floor(((s.lng - minLng) / lngRange) * gridSize), gridSize - 1);
        const cy = Math.min(Math.floor(((s.lat - minLat) / latRange) * gridSize), gridSize - 1);
        const k  = cy * gridSize + cx;
        if (!cells.has(k)) cells.set(k, s);
    }

    const result = [...cells.values()];
    if (result.length <= maxCount) return result;

    // Uniform stride reduction when the grid produced more entries than maxCount
    const step = Math.ceil(result.length / maxCount);
    return result.filter((_, i) => i % step === 0);
}

function _matches(p, activeFilters) {
    for (const [field, vals] of Object.entries(activeFilters)) {
        if (!vals || vals.length === 0) continue;
        if (!vals.includes(String(p[field] ?? ''))) return false;
    }
    return true;
}

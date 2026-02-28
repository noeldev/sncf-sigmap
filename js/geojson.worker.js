/**
 * geojson.worker.js
 * Fetches gzip tiles and filters signals off the main thread.
 *
 * Message IN:
 *   { type, urls, activeFilters, bounds,
 *     overviewTypes: string[]|null,  -- null means show all types (detail mode)
 *     maxSignals: number|null }      -- null means no limit (detail mode)
 *
 * Messages OUT:
 *   { status: 'progress', msg }
 *   { status: 'done', signals, sampled: bool, total: number }
 *   { status: 'error', error }
 */

self.onmessage = async function (e) {
  const { type, urls, activeFilters, bounds, overviewTypes, maxSignals } = e.data;
  if (type !== 'fetch-tiles') {
    self.postMessage({ status: 'error', error: `Unknown type: ${type}` });
    return;
  }

  try {
    self.postMessage({ status: 'progress', msg: `Loading ${urls.length} tile(s)…` });

    const tiles = await Promise.all(urls.map(_fetchTile));

    self.postMessage({ status: 'progress', msg: 'Filtering…' });

    const { swLat, swLng, neLat, neLng } = bounds;
    const overviewSet = overviewTypes ? new Set(overviewTypes) : null;
    const signals     = [];

    for (const tile of tiles) {
      if (!Array.isArray(tile)) continue;
      for (const s of tile) {
        // Bounds check (worker receives full tiles which may extend beyond viewport)
        if (s.lat < swLat || s.lat > neLat || s.lng < swLng || s.lng > neLng) continue;

        // Overview mode: restrict to primary types
        if (overviewSet && !overviewSet.has(s.type_if)) continue;

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

        // Attribute filters
        if (!_matches(p, activeFilters)) continue;

        signals.push({ lat: s.lat, lng: s.lng, p });
      }
    }

    // Overview mode: spatially subsample for even geographic coverage
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
    if (!r.ok) {
      // Only log unexpected errors (not 404 for tiles outside France)
      if (r.status !== 404) console.warn(`[Worker] ${url} → HTTP ${r.status}`);
      return [];
    }

    // Primary path: Content-Encoding: gzip set in netlify.toml
    // Browser decompresses automatically, r.json() works directly.
    const clone = r.clone();
    try {
      const data = await r.json();
      if (Array.isArray(data)) return data;
    } catch (_) { /* not auto-decompressed — try manual fallback */ }

    // Fallback: DecompressionStream (local dev without proper server headers)
    try {
      const body = clone.body.pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(body).text());
    } catch (_) { /* give up */ }

    return [];

  } catch (err) {
    console.warn(`[Worker] fetch failed: ${url}`, err.message);
    return [];
  }
}

/**
 * Spatially subsample to maxCount signals with even geographic distribution.
 * Divides the bounding box into a grid and keeps one signal per cell.
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
    if (cells.size >= maxCount) break;
  }

  return [...cells.values()];
}

function _matches(p, activeFilters) {
  for (const [field, vals] of Object.entries(activeFilters)) {
    if (!vals || vals.length === 0) continue;
    if (!vals.includes(String(p[field] ?? ''))) return false;
  }
  return true;
}

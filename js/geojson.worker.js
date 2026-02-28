/**
 * geojson.worker.js
 * Fetches gzip-compressed tile files and filters signals off the main thread.
 *
 * Two strategies are tried for each tile:
 * 1. fetch + response.json()  — works when server sends Content-Encoding: gzip
 *    (configured in netlify.toml). The browser decompresses transparently.
 * 2. If strategy 1 returns empty or throws, fall back to manual
 *    DecompressionStream (available in modern browsers and workers).
 */

self.onmessage = async function (e) {
  const { type, urls, activeFilters, bounds } = e.data;
  if (type !== 'fetch-tiles') {
    self.postMessage({ status: 'error', error: `Unknown type: ${type}` });
    return;
  }

  try {
    self.postMessage({ status: 'progress', msg: `Chargement de ${urls.length} tuile(s)…` });

    const results = await Promise.all(urls.map(url => _fetchTile(url)));

    self.postMessage({ status: 'progress', msg: 'Filtrage…' });

    const { swLat, swLng, neLat, neLng } = bounds;
    const signals = [];

    for (const tile of results) {
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

    self.postMessage({ status: 'done', signals });
  } catch (err) {
    self.postMessage({ status: 'error', error: err.message });
  }
};

async function _fetchTile(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    // Strategy 1: server sends Content-Encoding: gzip — browser decompresses
    // automatically, r.json() works directly.
    try {
      const data = await r.json();
      if (Array.isArray(data)) return data;
    } catch (_) {
      // json() failed — the response was not decompressed automatically.
      // Retry with manual DecompressionStream.
    }

    // Strategy 2: manual decompression via DecompressionStream
    const r2   = await fetch(url);
    const body = r2.body.pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(body).text();
    return JSON.parse(text);

  } catch (err) {
    console.warn('[Worker] tile failed:', url, err.message);
    return [];
  }
}

function _matches(p, activeFilters) {
  for (const [field, vals] of Object.entries(activeFilters)) {
    if (!vals || vals.length === 0) continue;
    if (!vals.includes(String(p[field] ?? ''))) return false;
  }
  return true;
}

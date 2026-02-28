/**
 * geojson.worker.js
 * Fetches tile files and filters signals off the main thread.
 *
 * Tile files are gzip-compressed JSON served with Content-Encoding: gzip
 * (configured in netlify.toml), so fetch().json() decompresses automatically.
 *
 * Message IN:
 *   { type: 'fetch-tiles', urls, activeFilters, bounds: {swLat,swLng,neLat,neLng} }
 *
 * Messages OUT:
 *   { status: 'progress', msg }
 *   { status: 'done', signals }
 *   { status: 'error', error }
 */

self.onmessage = async function (e) {
  const { type, urls, activeFilters, bounds } = e.data;

  if (type !== 'fetch-tiles') {
    self.postMessage({ status: 'error', error: `Unknown message type: ${type}` });
    return;
  }

  try {
    self.postMessage({ status: 'progress', msg: `Loading ${urls.length} tile(s)…` });

    const results = await Promise.all(urls.map(url =>
      fetch(url)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
          return r.json();
        })
        .catch(err => {
          console.warn('[Worker] tile fetch failed:', err.message);
          return [];
        })
    ));

    self.postMessage({ status: 'progress', msg: 'Filtering…' });

    const { swLat, swLng, neLat, neLng } = bounds;
    const signals = [];

    for (const tile of results) {
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

function _matches(p, activeFilters) {
  for (const [field, vals] of Object.entries(activeFilters)) {
    if (!vals || vals.length === 0) continue;
    if (!vals.includes(String(p[field] ?? ''))) return false;
  }
  return true;
}

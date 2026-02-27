/**
 * geojson.worker.js
 * Web Worker: parses a large GeoJSON text off the main thread
 * and posts back a lightweight feature array.
 * Keeps the UI responsive during file loading.
 */
self.onmessage = function (e) {
  const { type, text } = e.data;

  try {
    const json     = JSON.parse(text);
    const features = json.features || [];

    if (type === 'signals') {
      // Keep only Point features and strip redundant/heavy fields
      const points = features
        .filter(f => f.geometry && f.geometry.type === 'Point')
        .map(f => ({
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
          p: {
            type_if:    f.properties.type_if    || '',
            code_ligne: String(f.properties.code_ligne || ''),
            nom_voie:   f.properties.nom_voie   || '',
            sens:       f.properties.sens       || '',
            position:   f.properties.position   || '',
            pk:         f.properties.pk         || '',
            idreseau:   String(f.properties.idreseau || ''),
            code_voie:  f.properties.code_voie  || '',
          },
        }));
      self.postMessage({ type, features: points, total: points.length });

    } else {
      self.postMessage({ type, error: `Unknown type: ${type}` });
    }

  } catch (err) {
    self.postMessage({ type, error: err.message });
  }
};

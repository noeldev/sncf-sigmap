/**
 * osm-check.js
 * Check whether a signal already exists in OpenStreetMap via the Overpass API.
 * Returns the OSM node ID when found so the popup can link to openstreetmap.org/node/<id>.
 * Results are cached in memory for the session.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const FRANCE_BBOX  = '41.3,-5.5,51.2,9.6';

// TYPE_REF_TAG is auto-derived from signal-mapping.js
import { TYPE_REF_TAG } from './signal-mapping.js';

/**
 * Result shape:
 *   { status: 'in-osm',      nodeId: 12345678 }
 *   { status: 'not-in-osm',  nodeId: null }
 *   { status: 'unsupported', nodeId: null }
 *   { status: 'error',       nodeId: null }
 */

const _cache   = new Map();   // key -> result object
const _pending = new Map();   // key -> Promise<result>

/**
 * Check if a signal exists in OSM.
 * Returns Promise<{ status, nodeId }>.
 * Concurrent calls for the same id share a single network request.
 */
export function checkOsm(idreseau, type_if) {
  const unsupported = { status: 'unsupported', nodeId: null };
  if (!idreseau) return Promise.resolve(unsupported);

  const refTag = TYPE_REF_TAG[type_if];
  if (!refTag)   return Promise.resolve(unsupported);

  const key = `${refTag}:${idreseau}`;
  if (_cache.has(key))   return Promise.resolve(_cache.get(key));
  if (_pending.has(key)) return _pending.get(key);

  const query = [
    '[out:json][timeout:10];',
    `node["${refTag}"="${idreseau}"](${FRANCE_BBOX});`,
    'out ids;',
  ].join('');

  const promise = fetch(OVERPASS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'data=' + encodeURIComponent(query),
  })
    .then(r => r.json())
    .then(data => {
      const el     = data.elements?.[0];
      const result = el
        ? { status: 'in-osm',     nodeId: el.id }
        : { status: 'not-in-osm', nodeId: null  };
      _cache.set(key, result);
      _pending.delete(key);
      return result;
    })
    .catch(err => {
      console.warn('[osm-check]', idreseau, err.message);
      _pending.delete(key);
      // Do not cache errors so a retry is possible on the next popup open
      return { status: 'error', nodeId: null };
    });

  _pending.set(key, promise);
  return promise;
}

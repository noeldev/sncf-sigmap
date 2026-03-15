/**
 * tiles.js — Tile manifest loader and URL calculator.
 */

import { TILE_DEG, TILES_BASE } from './config.js';

let _manifest = null;

export async function loadManifest() {
  if (_manifest) return _manifest;
  try {
    const res = await fetch(TILES_BASE + 'manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _manifest = await res.json();
    return _manifest;
  } catch (err) {
    console.error('[Tiles] manifest.json failed:', err.message);
    return null;
  }
}

/**
 * Returns tile URLs that intersect the given Leaflet bounds,
 * optionally expanded by a buffer of extra tile rows/columns.
 *
 * The buffer pre-fetches neighbouring tiles so they are in the HTTP cache
 * before the viewport reaches them. A buffer of 1 means one extra tile in
 * each direction (N, S, E, W), adding at most ~12 tiles around the viewport
 * at zoom 14 on a typical screen. Those tiles are fetched in the background
 * and served from cache when the user pans into them.
 *
 * @param {L.LatLngBounds} bounds
 * @param {object}         manifest
 * @param {number}         [buffer=1]  Extra tile rows/cols to prefetch.
 */
export function getTileUrlsForBounds(bounds, manifest, buffer = 1) {
  if (!manifest) return [];

  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

    const txMin = Math.floor(sw.lng / TILE_DEG) - buffer;
    const txMax = Math.floor(ne.lng / TILE_DEG) + buffer;
    const tyMin = Math.floor(sw.lat / TILE_DEG) - buffer;
    const tyMax = Math.floor(ne.lat / TILE_DEG) + buffer;

  const urls = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const key = `${tx}:${ty}`;
      if (manifest.tiles[key]) {
        urls.push(TILES_BASE + `${tx}_${ty}.json.gz`);
      }
    }
  }
  return urls;
}

export function getManifestStats(manifest) {
  if (!manifest) return { tileCount: 0, totalSignals: 0 };
  let total = 0;
  for (const v of Object.values(manifest.tiles)) total += v;
  return { tileCount: Object.keys(manifest.tiles).length, totalSignals: total };
}

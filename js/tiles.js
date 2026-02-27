/**
 * tiles.js
 * Tile manifest loader and tile key calculator.
 * Determines which tile files to fetch for a given map bounds.
 */

import { TILE_DEG, TILES_BASE } from './config.js';

let _manifest = null;   // { tile_deg, tiles: { "tx:ty": count } }

export async function loadManifest() {
  if (_manifest) return _manifest;
  try {
    const res = await fetch(TILES_BASE + 'manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _manifest = await res.json();
    return _manifest;
  } catch (err) {
    console.error('[Tiles] Could not load manifest:', err.message);
    return null;
  }
}

/**
 * Returns all tile URLs that intersect the given Leaflet bounds.
 */
export function getTileUrlsForBounds(bounds, manifest) {
  if (!manifest) return [];

  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const txMin = Math.floor(sw.lng / TILE_DEG);
  const txMax = Math.floor(ne.lng / TILE_DEG);
  const tyMin = Math.floor(sw.lat / TILE_DEG);
  const tyMax = Math.floor(ne.lat / TILE_DEG);

  const urls = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const key = `${tx}:${ty}`;
      if (manifest.tiles[key]) {
        // File name mirrors TileBuilder output: tx_ty.json.gz
        urls.push(TILES_BASE + `${tx}_${ty}.json.gz`);
      }
    }
  }
  return urls;
}

/**
 * Returns all unique type_if and code_ligne values from the manifest
 * (used to populate filters before any tile is loaded).
 * Requires a full-index tile or pre-built values list — falls back to
 * collecting from loaded tiles progressively.
 */
export function getManifestStats(manifest) {
  if (!manifest) return { tileCount: 0, totalSignals: 0 };
  let total = 0;
  for (const v of Object.values(manifest.tiles)) total += v;
  return { tileCount: Object.keys(manifest.tiles).length, totalSignals: total };
}

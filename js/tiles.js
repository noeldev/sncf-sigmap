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

/** Returns tile URLs that intersect the given Leaflet bounds. */
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

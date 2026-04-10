/**
 * signal-locator.js — Signal geolocation and fly-to logic.
 *
 * Owns the networkId → tileKey spatial index (built from index.json).
 * Provides flyToSignal(networkId) as the single entry point for any module
 * that needs to centre the map on a specific signal.
 *
 * Also exposes searchNetworkIds(prefix) so the networkId filter dropdown in
 * filters.js can query the index without knowing its internal structure.
 *
 * Public API:
 *   initFromIndex(indexData)     — build the index from the parsed index.json object
 *   flyToSignal(networkId)       — fly to a signal; fast path if already visible
 *   searchNetworkIds(prefix)     — return all networkIds that start with prefix
 */

import { flyToLocationWithMarker } from './map.js';
import { getSignalLatlng } from './map-layer.js';
import { fetchTileByKey, findSignalLocation } from './tiles.js';

/** @type {Map<string, string>}  networkId → tileKey  e.g. '12345' → '3:94' */
let _networkIdToTile = new Map();


/**
 * Build the spatial index from the raw index.json data.
 * Called once by filters.js immediately after index.json is loaded.
 *
 * Expected structure: data.networkId = { "3:94": ["10045678", …], … }
 *
 * @param {object} indexData  Parsed index.json object.
 */
export function initFromIndex(indexData) {
    if (!indexData?.networkId) return;

    const map = new Map();
    for (const [tileKey, ids] of Object.entries(indexData.networkId)) {
        for (const id of ids) map.set(id, tileKey);
    }
    _networkIdToTile = map;
    console.info(`[Locator] networkId index: ${map.size.toLocaleString()} entries`);
}

/**
 * Return all known networkIds that start with the given prefix string.
 * Used by the networkId filter dropdown to populate search results.
 *
 * @param {string} prefix
 * @returns {string[]}
 */
export function searchNetworkIds(prefix) {
    if (!prefix) return [];
    return [..._networkIdToTile.keys()].filter(id => id.startsWith(prefix));
}

/**
 * Fly to the signal with the given network ID and show a location marker.
 *
 * Fast path: signal is currently visible in the viewport → immediate flight.
 * Slow path: fetch the tile that contains the signal (browser-cached on repeat
 *            calls), then fly once the coordinates are known.
 *
 * @param {string} networkId
 * @returns {Promise<void>}
 */
export async function flyToSignal(networkId) {
    // Fast path — signal is already rendered in the viewport.
    const latlng = getSignalLatlng(networkId);
    if (latlng) {
        flyToLocationWithMarker(latlng);
        return;
    }

    const tileKey = _networkIdToTile.get(networkId);
    if (!tileKey) {
        // Index not yet loaded, or networkId genuinely absent.
        // In normal operation the index is populated before the user can
        // interact, so this branch is mostly defensive.
        console.warn(`[Locator] No tile key for networkId ${networkId}`);
        return;
    }

    const signals = await fetchTileByKey(tileKey);
    const location = findSignalLocation(signals, networkId);
    if (location) flyToLocationWithMarker(location);
}

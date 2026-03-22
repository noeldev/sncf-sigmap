/**
 * map-controls.js — Map toolbar button wiring.
 *
 * Extracted from map.js to keep map.js focused on Leaflet infrastructure
 * (tile layers, basemap selector) and match the structure of index.html,
 * where #map-controls is a sibling of #map, not part of the Leaflet instance.
 *
 * Responsibilities:
 *   - Wire click handlers for all #map-controls buttons.
 *   - Handle geolocation (getCurrentPosition) and fullscreen toggling.
 *   - Sync the fullscreen button active state via the fullscreenchange event.
 *
 * Public API:
 *   initMapControls() — call once from app.js/_boot() after initMap() resolves.
 */

import { MAP_BBOX, MAP_STARTUP_ZOOM } from './config.js';
import { map } from './map.js';
import { t } from './i18n.js';

/**
 * Wire all map toolbar buttons.
 * Must be called after initMap() so that the Leaflet map instance exists.
 */
export function initMapControls() {
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => map.zoomIn());
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => map.zoomOut());
    document.getElementById('btn-reset-view')?.addEventListener('click', _resetView);
    document.getElementById('btn-geolocate')?.addEventListener('click', _geolocate);
    document.getElementById('btn-fullscreen')?.addEventListener('click', _toggleFullscreen);
    document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('sidebar-closed');
        setTimeout(() => map.invalidateSize(), 210);
    });
    document.addEventListener('fullscreenchange', () =>
        document.getElementById('btn-fullscreen')?.classList.toggle('active', !!document.fullscreenElement)
    );
}

/* ===== Private helpers ===== */

/** Return to the initial map extent. */
function _resetView() {
    map.fitBounds(MAP_BBOX, { maxZoom: MAP_STARTUP_ZOOM });
}

function _geolocate() {
    if (!navigator.geolocation) {
        alert(t('ctrl.geolocateUnavailable'));
        return;
    }
    const btn = document.getElementById('btn-geolocate');
    btn?.classList.add('active');
    navigator.geolocation.getCurrentPosition(
        pos => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            L.circle([lat, lng], {
                radius: accuracy,
                color: '#2589c7',
                fillOpacity: .1,
                weight: 1
            }).addTo(map);
            L.circleMarker([lat, lng], {
                radius: 7,
                color: '#fff',
                fillColor: '#2589c7',
                fillOpacity: 1,
                weight: 2,
            }).addTo(map).bindPopup(`±${Math.round(accuracy)} m`);
            map.setView([lat, lng], Math.min(Math.max(map.getZoom(), 14), 17), { animate: false });
            btn?.classList.remove('active');
        },
        err => {
            btn?.classList.remove('active');
            alert(t('ctrl.geolocateError', err.message));
        },
        {
            enableHighAccuracy: true,
            timeout: 10000
        }
    );
}

function _toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
    } else {
        document.getElementById('app')?.requestFullscreen().catch(() => { });
    }
}

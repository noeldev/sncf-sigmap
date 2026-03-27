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
import { t } from './translation.js';
import { getControlsCollapsed, setControlsCollapsed } from './prefs.js';
import { map, flyToLocation } from './map.js';

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
    document.getElementById('btn-basemap')?.addEventListener('click', _toggleBasemapPanel);
    document.getElementById('btn-controls-toggle')?.addEventListener('click', _toggleControls);
    _applyCollapsed(getControlsCollapsed(), false);

    // Close basemap panel when clicking outside it.
    document.addEventListener('click', e => {
        if (!e.target.closest('#basemap-panel') && !e.target.closest('#btn-basemap')) {
            _closeBasemapPanel();
        }
    });
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
        pos => _onGeolocateSuccess(pos, btn),
        err => _onGeolocateError(err, btn),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// Persistent reference to geolocation layers
let _geoMarkers = [];

// Handle successful geolocation
function _onGeolocateSuccess(pos, btn) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;

    // Remove existing markers from previous calls to prevent artifacts
    _geoMarkers.forEach(m => m.remove());
    _geoMarkers = [];

    // Initialize accuracy circle without adding it to the map
    const accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#2589c7',
        fillOpacity: 0.1,
        weight: 1,
    });

    // Initialize position marker without adding it to the map
    const posMarker = L.circleMarker([lat, lng], {
        radius: 7,
        color: '#fff',
        fillColor: '#2589c7',
        fillOpacity: 1,
        weight: 2,
    }).bindPopup(`±${Math.round(accuracy)} m`);

    // Store references for the next cleanup cycle
    _geoMarkers.push(accuracyCircle, posMarker);

    // Display logic to be triggered at the end of the flight
    let markersDisplayed = false;
    const displayMarkers = () => {
        if (markersDisplayed) return;
        markersDisplayed = true;
        map.off('moveend', displayMarkers);
        accuracyCircle.addTo(map);
        posMarker.addTo(map);
    };

    // Interrupt flight and show markers if user interacts
    const stopFly = () => {
        map.stop();
        displayMarkers();
    };

    // Event listeners for flight lifecycle
    map.once('mousedown touchstart', stopFly);
    map.once('moveend', displayMarkers);

    // Start animated transition while markers are detached
    flyToLocation([lat, lng]);

    btn?.classList.remove('active');
}

function _onGeolocateError(err, btn) {
    btn?.classList.remove('active');
    alert(t('ctrl.geolocateError', err.message));
}

function _toggleControls() {
    const collapsed = !getControlsCollapsed();
    setControlsCollapsed(collapsed);
    _applyCollapsed(collapsed, true);
}

/**
 * Apply collapsed/expanded state to #map-controls.
 * @param {boolean} collapsed
 * @param {boolean} animate   false on initial restore (avoids transition flash)
 */
function _applyCollapsed(collapsed, animate) {
    const bar = document.getElementById('map-controls');
    const btn = document.getElementById('btn-controls-toggle');
    if (!bar) return;
    if (!animate) bar.classList.add('no-transition');
    bar.classList.toggle('is-collapsed', collapsed);
    if (!animate) requestAnimationFrame(() => bar.classList.remove('no-transition'));
    const titleKey = collapsed ? 'ctrl.expand' : 'ctrl.collapse';
    if (btn) {
        btn.title = t(titleKey);
        btn.dataset.i18nTitle = titleKey;
    }
}

function _toggleBasemapPanel() {
    const panel = document.getElementById('basemap-panel');
    const btn = document.getElementById('btn-basemap');
    if (!panel) return;
    const opening = panel.classList.toggle('is-hidden');
    btn?.classList.toggle('active', !opening);
}

function _closeBasemapPanel() {
    const panel = document.getElementById('basemap-panel');
    if (!panel?.classList.contains('is-hidden')) {
        panel.classList.add('is-hidden');
        document.getElementById('btn-basemap')?.classList.remove('active');
    }
}

function _toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
    } else {
        document.getElementById('app')?.requestFullscreen().catch(() => { });
    }
}

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
import { t, openHelpPage } from './translation.js';
import { getControlsCollapsed, setControlsCollapsed } from './prefs.js';
import { map, flyToLocation } from './map.js';
import { showSignalContextMenu } from './map-layer.js';

/**
 * Wire all map toolbar buttons.
 * Must be called after initMap() so that the Leaflet map instance exists.
 */
// Map button id → action — single source of truth for toolbar wiring.
const BTN_ACTIONS = {
    'btn-sidebar-toggle': _toggleSidebar,
    'btn-zoom-in': () => map.zoomIn(),
    'btn-zoom-out': () => map.zoomOut(),
    'btn-reset-view': _resetView,
    'btn-geolocate': _geolocate,
    'btn-fullscreen': _toggleFullscreen,
    'btn-basemap': _toggleBasemapPanel,
    'btn-help': () => openHelpPage('map'),
    'btn-controls-toggle': _toggleControls
};

export function initMapControls() {
    _applyCollapsed(getControlsCollapsed(), false);

    // Single delegated click on #map-controls handles every toolbar button.
    document.getElementById('map-controls')?.addEventListener('click', e => {
        const btn = e.target.closest('button[id]');
        if (btn) BTN_ACTIONS[btn.id]?.();
    });

    // Close basemap panel when clicking outside it.
    document.addEventListener('click', e => {
        if (!e.target.closest('#basemap-panel') && !e.target.closest('#btn-basemap'))
            _closeBasemapPanel();
    });

    document.addEventListener('fullscreenchange', () =>
        document.getElementById('btn-fullscreen')?.classList.toggle('active', !!document.fullscreenElement)
    );
}

// ===== Private helpers =====

function _toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.classList.toggle('sidebar-closed');

    let invalidated = false;
    const invalidate = () => {
        if (invalidated) return;
        invalidated = true;
        sidebar.removeEventListener('transitionend', invalidate);
        map.invalidateSize();
    };

    sidebar.addEventListener('transitionend', invalidate, { once: true });

    // Fallback for reduced-motion settings or interrupted transitions.
    setTimeout(invalidate, 300);
}

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

/**
 * Handle successful geolocation: shows a pulsing user marker immediately
 * and delays the accuracy circle until the map movement (flyTo) finishes.
 * @param {GeolocationPosition} pos 
 * @param {HTMLElement} [btn] - The geolocation button to reset state
 */
function _onGeolocateSuccess(pos, btn) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;

    // Clear previous geolocation state to avoid multiple markers
    _geoMarkers.forEach(m => m.remove());
    _geoMarkers = [];

    // Create the accuracy circle (real-world meters bounds)
    const accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#2589c7',
        fillOpacity: 0.2,
        weight: 1,
        className: 'gps-accuracy-circle'
    });

    // Create the pulsing dot using a divIcon for stable rendering during zoom
    const pulseIcon = L.divIcon({
        className: 'gps-pulse-icon',
        html: '<div class="gps-pulse-ring"></div><div class="gps-pulse-dot"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    // Position marker using the custom icon
    const posMarker = L.marker([lat, lng], {
        icon: pulseIcon,
        zIndexOffset: 1000
    }).bindPopup(`±${Math.round(accuracy)} m`);

    // Keep references for cleanup in the next geolocation cycle
    _geoMarkers.push(accuracyCircle, posMarker);

    // Show the dot immediately as it handles CSS transforms gracefully
    posMarker.addTo(map);

    const showCircle = () => {
        map.off('moveend', showCircle);
        // Safety check: only add the circle if it hasn't been cleared by a new request
        if (_geoMarkers.includes(accuracyCircle)) {
            accuracyCircle.addTo(map);
        }
    };

    // Delay the SVG circle until the map is stable
    map.once('moveend', showCircle);

    // Interrupt flight and show circle if the user interacts with the map
    map.once('mousedown touchstart', () => {
        map.stop();
        showCircle();
    });

    // Execute the transition
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
    // Close the basemap panel when collapsing — the btn-basemap button is hidden,
    // leaving no visible trigger to close the panel otherwise.
    if (collapsed) _closeBasemapPanel();
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
    // Focus the active basemap button when opening so keyboard users can navigate.
    // requestAnimationFrame ensures the panel is visible (not display:none) before focus.
    if (!opening) {
        requestAnimationFrame(() => {
            (panel.querySelector('.basemap-btn.active') ?? panel.querySelector('.basemap-btn'))?.focus();
        });
    }
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

/**
 * Wire keyboard shortcuts for all map toolbar actions.
 * Ignored when the event originates from a text input or contenteditable.
 * Must be called after initMapControls() so private functions are defined.
 */
export function initKeyboardShortcuts() {
    window.addEventListener('keydown', e => {
        // Do not intercept keystrokes while the user is typing.
        if (e.target.matches('input, textarea, [contenteditable]')) return;

        // Marker-level shortcuts (work on the Tab-focused .sig-dot)
        // Leaflet's marker icon is div.leaflet-marker-icon; .sig-dot is inside it.
        // We check querySelector (down) because activeElement is the icon container.
        const el = document.activeElement;
        const focusedDot = el?.classList.contains('sig-dot')
            ? el
            : (el?.querySelector('.sig-dot') ?? null);

        if (focusedDot) {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                // Enter / Alt+Enter → open signal popup (Properties).
                e.preventDefault();
                focusedDot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return;
            }
            if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                // ContextMenu / Shift+F10 → open context menu at the focused marker.
                e.preventDefault();
                // The browser fires a native contextmenu event after the ContextMenu key,
                // even when keydown is prevented. Swallow it once so only our menu appears.
                window.addEventListener('contextmenu', evt => evt.preventDefault(),
                    { once: true, capture: true });
                showSignalContextMenu();
                return;
            }
        }

        // Do not intercept modified shortcuts (Ctrl+S, Alt+Home, etc.) for toolbar.
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // Toolbar / map-level shortcuts
        switch (e.key) {
            case '+':
                e.preventDefault();
                map.zoomIn();
                break;
            case '-':
                e.preventDefault();
                map.zoomOut();
                break;
            case 'Home':
                e.preventDefault();
                _resetView();
                break;
            case 'F11':
                e.preventDefault();
                _toggleFullscreen();
                break;
            case 'Escape':
                _closeBasemapPanel();
                break;
            case 'b':
            case 'B':
                e.preventDefault();
                _toggleBasemapPanel();
                break;
            case '?':
                e.preventDefault();
                openHelpPage('map');
                break;
            case 'l':
            case 'L':
                e.preventDefault();
                _geolocate();
                break;
            case 's':
            case 'S':
                e.preventDefault();
                _toggleSidebar();
                break;
            case 't':
            case 'T':
                e.preventDefault();
                _toggleControls();
                break;
        }
    });
}

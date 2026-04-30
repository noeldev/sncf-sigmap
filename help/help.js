/**
 * help.js — Shared logic for standalone help pages.
 *
 * Responsibilities:
 *   1. Send commands to the main app (switch sidebar tab) via BroadcastChannel.
 *
 * Language is controlled by the main app: the app opens the correct locale
 * path based on its current language setting.
 */

import { sendHelpSwitchTab } from '../js/help-channel.js';

document.addEventListener('DOMContentLoaded', () => {
    // Links that open a tab in the main app sidebar.
    // Uses BroadcastChannel so it works across browser tabs.
    document.querySelectorAll('[data-app-tab]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            sendHelpSwitchTab(link.dataset.appTab);
        });
    });
});

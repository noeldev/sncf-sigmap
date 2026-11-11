/**
 * help.js — Shared logic for standalone help pages.
 *
 * Responsibilities:
 *   1. Send commands to the main app (switch sidebar tab) via BroadcastChannel.
 *   2. Add the build line (date and commit of the deployed site) to the page
 *      footer, in the language of the page (help/<locale>/).
 *
 * Language is controlled by the main app: the app opens the correct locale
 * path based on its current language setting.
 */

import { sendHelpSwitchTab } from '../js/app/help-channel.js';
import { loadBuildInfo, renderBuildInfo } from '../js/core/build-info.js';

document.addEventListener('DOMContentLoaded', () => {
    // Links that open a tab in the main app sidebar.
    // Uses BroadcastChannel so it works across browser tabs.
    document.querySelectorAll('[data-app-tab]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            sendHelpSwitchTab(link.dataset.appTab);
        });
    });

    _addBuildLine();
});

/**
 * Append the build line to the footer, with the text of the About tab taken
 * from the strings file of the page locale. Nothing is added on a local
 * server (no build information) or on a page without footer.
 */
async function _addBuildLine() {
    const footer = document.querySelector('.help-footer');
    const info = footer && await loadBuildInfo();
    if (!info) return;
    const locale = location.pathname.split('/').at(-2);
    try {
        const res = await fetch(`../../strings/strings.${locale}.json`);
        if (!res.ok) return;
        const template = (await res.json()).about?.credits?.build;
        if (!template) return;
        const line = document.createElement('p');
        line.className = 'help-build';
        renderBuildInfo(line, template, info);
        footer.append(line);
    } catch {
        /* strings unavailable: no build line */
    }
}

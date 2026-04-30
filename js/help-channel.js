/**
 * help-channel.js — BroadcastChannel abstraction for cross-tab communication
 * between the main app and standalone help pages.
 *
 * The main app listens for commands (e.g. switch-tab) and the help pages
 * send them. The channel name is private to this module to avoid spreading
 * constants across the codebase.
 *
 * Public API — specialised commands (no need to export message types):
 *   sendHelpSwitchTab(tab)        — ask the main app to switch sidebar tab
 *   onHelpSwitchTabCommand(callback) — register a listener for switch-tab commands
 *
 * Usage in help pages:
 *   import { sendHelpSwitchTab } from '../js/help-channel.js';
 *   sendHelpSwitchTab('tab-filters');
 *
 * Usage in sidebar.js (main app):
 *   import { onHelpSwitchTabCommand } from './help-channel.js';
 *   onHelpSwitchTabCommand(tab => _switchToTab(tab));
 */

const CHANNEL_NAME = 'sncf-sigmap';

let _channel = null;

/**
 * Get or create the singleton BroadcastChannel instance.
 * @returns {BroadcastChannel}
 */
function _getChannel() {
    if (!_channel) {
        _channel = new BroadcastChannel(CHANNEL_NAME);
    }
    return _channel;
}

/**
 * Send a raw command over the channel.
 * @param {string} type - Command type (e.g. 'switch-tab')
 * @param {object} data - Payload (merged into the message object)
 */
function _sendCommand(type, data = {}) {
    _getChannel().postMessage({ type, ...data });
}

// ===== Public specialised commands =====

/**
 * Ask the main app to switch to a specific sidebar tab.
 * @param {string} tab - Tab element id (e.g. 'tab-filters', 'tab-settings')
 */
export function sendHelpSwitchTab(tab) {
    _sendCommand('switch-tab', { tab });
}

/**
 * Register a callback for switch-tab commands.
 * @param {function(string): void} callback - Receives the tab id
 * @returns {function()} Unsubscribe function
 */
export function onHelpSwitchTabCommand(callback) {
    const handler = (e) => {
        if (e.data?.type === 'switch-tab' && e.data.tab) {
            callback(e.data.tab);
        }
    };
    _getChannel().addEventListener('message', handler);
    return () => _getChannel().removeEventListener('message', handler);
}
/**
 * tooltip.js
 * Builds the Leaflet tooltip shown on marker hover.
 *
 * HTML structure in index.html:
 *   tpl-signal-tooltip   — outer wrapper (.tt-groups / .tt-sep / .tt-common)
 *   tpl-tt-sig-row       — one type + id row
 *   tpl-tt-common-fields — pre-labelled field rows (labels defined in HTML)
 *
 * Multi-signal grouping logic:
 *   • lineCode, trackCode, trackName, milepost are always identical for co-located signals
 *     → always listed at the bottom after the separator.
 *   • If direction and placement are the same for all signals:
 *       TYPE1  ID1
 *       TYPE2  ID2
 *       ───
 *       Track code / Track name / Direction / Placement / Milepost
 *   • If direction or placement differ, signals are grouped by (direction, placement).
 *     Each group shows its type+id rows followed by its specific values.
 *     Groups are separated by a divider; shared fields remain at the bottom:
 *       TYPE1  ID1
 *       Direction: Increasing  Placement: Right
 *       ───
 *       TYPE2  ID2
 *       Direction: Decreasing  Placement: Left
 *       ───
 *       Track code / Track name / Milepost
 */

import { getTypeColor, sortSignalsByNetworkId } from './signal-mapping.js';
import { t, translateElement } from './translation.js';

// Template references — ES modules are deferred, so the DOM is fully parsed
// before this module is evaluated.  A single getElementById call per template
// is made here instead of on every tooltip build / sig-row clone.
let _tplTooltip = null;
let _tplSigRow = null;
let _tplCommon = null;

function _getTemplates() {
    if (!_tplTooltip) {
        _tplTooltip = document.getElementById('tpl-signal-tooltip').content;
        _tplSigRow = document.getElementById('tpl-tt-sig-row').content;
        _tplCommon = document.getElementById('tpl-tt-common-fields').content;
    }
}

/**
 * Build and return the tooltip DOM node for a co-located group of signals.
 * Leaflet accepts an HTMLElement directly as tooltip content.
 */
export function buildTooltip(feats) {
    _getTemplates();
    const wrap = _tplTooltip.cloneNode(true).querySelector('.tt-wrap');

    const groupsContainer = wrap.querySelector('.tt-groups');
    const commonContainer = wrap.querySelector('.tt-common');

    const sorted = sortSignalsByNetworkId(feats);
    const p0 = sorted[0].p;
    // canGroup: true when all co-located signals share direction and placement
    // — they can be listed in a single block with shared field values at the bottom.
    const canGroup = sorted.every(
        f => f.p.direction === p0.direction && f.p.placement === p0.placement
    );

    if (canGroup) {
        // Single block: all type+id rows together; direction+placement go to the bottom section.
        for (const f of sorted) {
            groupsContainer.appendChild(_makeSigRow(f));
        }
        _appendFields(commonContainer, p0, ['lineCode', 'trackCode', 'trackName', 'direction', 'placement', 'milepost']);
    } else {
        // Group by (direction, placement) combination.
        const groups = _groupByDirectionPlacement(sorted);
        let first = true;

        for (const groupFeats of groups.values()) {
            // Separator between groups (not before the first one).
            if (!first) groupsContainer.appendChild(_makeSep());
            first = false;

            for (const f of groupFeats) {
                groupsContainer.appendChild(_makeSigRow(f));
            }
            // Direction and placement are specific to this group.
            _appendFields(groupsContainer, groupFeats[0].p, ['direction', 'placement']);
        }
        // Only the truly common fields go at the bottom.
        _appendFields(commonContainer, p0, ['lineCode', 'trackCode', 'trackName', 'milepost']);
    }

    // Translate all data-i18n labels (e.g. .tt-key) in one pass
    // after all template rows have been appended to the wrap.
    translateElement(wrap);
    return wrap;
}

// ===== Private helpers =====

/** Group feats by their (direction, placement) combination, preserving insertion order. */
function _groupByDirectionPlacement(feats) {
    const groups = new Map();
    for (const f of feats) {
        // Use '|' as separator — direction and placement values never contain it.
        const key = `${f.p.direction ?? ''}|${f.p.placement ?? ''}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(f);
    }
    return groups;
}

/** Clone one type + id row from the template. */
function _makeSigRow(f) {
    const row = _tplSigRow.cloneNode(true).querySelector('.tt-row');
    const typeEl = row.querySelector('.tt-type');
    typeEl.textContent = f.p.signalType || '?';
    typeEl.style.setProperty('--tt-type-color', getTypeColor(f.p.signalType));
    row.querySelector('.tt-id').textContent = f.p.networkId ?? '';
    return row;
}

/** Clone a separator element. */
function _makeSep() {
    return _tplTooltip.querySelector('.tt-sep').cloneNode(true);
}

/**
 * Clone individual field rows from tpl-tt-common-fields and append them to
 * the target container — but only for fields that have a non-empty value.
 * Labels are already defined in the template HTML; JS only fills the values.
 * Coded values (direction, placement) are translated via i18n.
 */
function _appendFields(container, p, fields) {
    for (const field of fields) {
        const val = p[field];
        if (!val || val === 'unknown') continue;
        const row = _tplCommon.querySelector(`[data-field="${field}"]`)?.cloneNode(true);
        if (!row) continue;
        // Values for direction and placement are translated dynamically.
        const valueKey = `values.${field}.${val}`;
        const translated = t(valueKey);
        const display = (translated !== valueKey) ? translated : val;
        row.querySelector('.tt-val').textContent = display;
        container.appendChild(row);
    }
}

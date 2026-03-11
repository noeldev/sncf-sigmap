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
 *   • code_voie, nom_voie, pk are always identical for co-located signals
 *     → always listed at the bottom after the separator.
 *   • If sens and position are the same for all signals:
 *       TYPE1  ID1
 *       TYPE2  ID2
 *       ───
 *       Code voie / Nom voie / Sens / Position / PK
 *   • If sens and/or position differ, signals are grouped by (sens, position).
 *     Each group shows its type+id rows followed by its specific sens/position.
 *     Groups are separated by a divider; shared fields remain at the bottom:
 *       TYPE1  ID1
 *       Sens: A  Position: X
 *       ───
 *       TYPE2  ID2
 *       Sens: B  Position: Y
 *       ───
 *       Code voie / Nom voie / PK
 */

import { getTypeColor } from './signal-mapping.js';

// Template references — ES modules are deferred, so the DOM is fully parsed
// before this module is evaluated.  A single getElementById call per template
// is made here instead of on every tooltip build / sig-row clone.
let _tplTooltip = null;
let _tplSigRow = null;
let _tplCommon = null;

function _getTpls() {
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
    _getTpls();
    const wrap = _tplTooltip.cloneNode(true).querySelector('.tt-wrap');

    const groupsContainer = wrap.querySelector('.tt-groups');
    const commonContainer = wrap.querySelector('.tt-common');

    const p0 = feats[0].p;
    const allSameSensPos = feats.every(
        f => f.p.sens === p0.sens && f.p.position === p0.position
    );

    if (allSameSensPos) {
        // Single block: all type+id rows together; sens+position go to the bottom section.
        for (const f of feats) {
            groupsContainer.appendChild(_makeSigRow(f));
        }
        _appendFields(commonContainer, p0, ['code_voie', 'nom_voie', 'sens', 'position', 'pk']);
    } else {
        // Group by (sens, position) combination.
        const groups = _groupBySensPos(feats);
        let first = true;

        for (const groupFeats of groups.values()) {
            // Separator between groups (not before the first one).
            if (!first) groupsContainer.appendChild(_makeSep());
            first = false;

            for (const f of groupFeats) {
                groupsContainer.appendChild(_makeSigRow(f));
            }
            // Sens and position are specific to this group.
            _appendFields(groupsContainer, groupFeats[0].p, ['sens', 'position']);
        }
        // Only the truly common fields go at the bottom.
        _appendFields(commonContainer, p0, ['code_voie', 'nom_voie', 'pk']);
    }

    return wrap;
}

/* ===== Internal helpers ===== */

/** Group feats by their (sens, position) combination, preserving insertion order. */
function _groupBySensPos(feats) {
    const groups = new Map();
    for (const f of feats) {
        const key = `${f.p.sens ?? ''}\x00${f.p.position ?? ''}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(f);
    }
    return groups;
}

/** Clone one type + id row from the template. */
function _makeSigRow(f) {
    const row = _tplSigRow.cloneNode(true).querySelector('.tt-row');
    const typeEl = row.querySelector('.tt-type');
    typeEl.textContent = f.p.type_if || '?';
    typeEl.style.setProperty('--tt-type-color', getTypeColor(f.p.type_if));
    row.querySelector('.tt-id').textContent = f.p.idreseau ?? '';
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
 */
function _appendFields(container, p, fields) {
    for (const field of fields) {
        const val = p[field];
        if (!val) continue;
        const row = _tplCommon.querySelector(`[data-field="${field}"]`).cloneNode(true);
        row.querySelector('.tt-val').textContent = val;
        container.appendChild(row);
    }
}

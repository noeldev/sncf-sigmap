// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * osm-tags.js - OSM tag generation from SIGNAL_MAPPING entries.
 *
 * Extracts the tag-building logic from signal-mapping.js into a dependency-free
 * module so it can be shared between the main application and the validation tool.
 *
 * The fixme OSM tag value is always English — OSM tags are language-independent.
 *
 * Public API:
 *   buildNodeTags(feats, opts) -> Map<string, string>
 */

import { resolveGroupDefs, getMappingEntry } from './signal-types.js';
import { milepostToDecimalKm } from './sncf-convert.js';

/**
 * Build the OSM tag key for a signal category.
 *
 * Single source of truth for the 'railway:signal:<cat>' prefix pattern.
 * Use this instead of inline string concatenation so the schema prefix is
 * never duplicated across modules.
 *
 * @param {string} cat  OSM category suffix, e.g. 'main', 'speed_limit'
 * @returns {string}    e.g. 'railway:signal:main'
 */
export function makeSignalCatKey(cat) {
    return `railway:signal:${cat}`;
}

/**
 * Return the full OSM :ref tag key for a signal type, or null when unmapped.
 * Moved here from signal-mapping.js so all railway:signal:* key construction
 * lives in one module.
 *
 * @param {string} signalType  GAIA key, e.g. 'CARRE'
 * @returns {string|null}      e.g. 'railway:signal:main:ref', or null
 */
export function getSignalId(signalType) {
    const entry = getMappingEntry(signalType);
    return entry ? `${makeSignalCatKey(entry.cat)}:ref` : null;
}

/**
* Build the complete OSM tag Map for a node group.
 *
 * Tags written for every node:
 *   railway=signal
 *   railway:position:exact    - milepost as decimal km
 *   railway:signal:direction  - forward | backward | both
 *   railway:signal:position   - left | right | bridge
 *
 * For each mapped signal in the group (resolved via resolveSignalDef):
 *   - Luminous signals use the SIGNAL_MAPPING definition (form:light, shape, states…).
 *   - Mechanical combos (CARRE+A+RR30, A+D) use MECHANICAL_MAPPING (form:sign only).
 *   - R30 and RR30 always resolve to MECHANICAL_MAPPING regardless of co-location.
 *   railway:signal:<cat>=<type>
 *   railway:signal:<cat>:<property>=<value>   (from mapping.properties)
 *   railway:signal:<cat>:ref=<networkId>
 *
 * For unmapped signals:
 *   fixme=Unavailable specs: '<type>' (<networkId>)
 *
  * @param {Array<{ p: object }>} nodeFeats
 *   Signals belonging to this OSM node.
 * @param {{ isMech?: boolean }} opts
 *   isMech: pre-computed mechanical flag for this location, produced by
 *   groupFeats(). When true, resolveGroupDefs() selects mechanical properties
 *   for signals that have a mechanical section (CARRE, A, D) and uses
 *   form=sign instead of form=light.
 * @returns {Map<string, string>}
 */
export function buildNodeTags(nodeFeats, { isMech = false } = {}) {
    const tags = new Map();
    const first = nodeFeats[0].p;

    tags.set('railway', 'signal');
    tags.set('railway:position:exact', milepostToDecimalKm(first.milepost));
    if (first.direction !== 'unknown') tags.set('railway:signal:direction', first.direction);
    if (first.placement !== 'unknown') tags.set('railway:signal:position', first.placement);

    const defs = resolveGroupDefs(nodeFeats, isMech);
    const unsupported = new Map();

    for (const feat of nodeFeats) {
        const { signalType, networkId } = feat.p;
        const def = defs.get(signalType);

        if (def) {
            const prefix = makeSignalCatKey(def.cat);
            tags.set(prefix, def.type);
            for (const [k, v] of Object.entries(def.properties ?? {})) {
                tags.set(`${prefix}:${k}`, v);
            }
            if (networkId) tags.set(`${prefix}:ref`, networkId);
        } else {
            if (!unsupported.has(signalType)) unsupported.set(signalType, []);
            if (networkId) unsupported.get(signalType).push(networkId);
        }
    }

    if (unsupported.size > 0) {
        const items = [...unsupported.entries()].map(([type, ids]) =>
            `'${type}'` + (ids.length ? ` (${ids.join(', ')})` : '')
        );
        tags.set('fixme', `Unavailable specs: ${items.join('; ')}`);
    }

    tags.set('source', 'SNCF - 03/2022');
    return tags;
}

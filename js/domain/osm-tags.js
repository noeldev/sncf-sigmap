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
 * When the entry has a subcat, the ref sits under <cat>:<subcat>:ref.
 *
 * @param {string} signalType  GAIA key, e.g. 'CARRE', 'REP TGV'
 * @returns {string|null}      e.g. 'railway:signal:main:ref'
 *                             or   'railway:signal:train_protection:main:ref'
 */
export function getSignalId(signalType) {
    const entry = getMappingEntry(signalType);
    if (!entry) return null;
    const base = makeSignalCatKey(entry.cat);
    return entry.subcat ? `${base}:${entry.subcat}:ref` : `${base}:ref`;
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
 *   - Luminous signals use the standard luminous definition (form:light, shape, states…).
 *   - Mechanical combos (CARRE+A+RR30, A+D) use the mechanical definition (form:sign only).
 *   - R30 and RR30 always resolve to their mechanical definition regardless of co-location.
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
            const catPrefix = makeSignalCatKey(def.cat);
            // propPrefix is where properties and :ref live.
            // Without subcat: railway:signal:<cat>
            // With subcat:    railway:signal:<cat>:<subcat>
            const propPrefix = def.subcat ? `${catPrefix}:${def.subcat}` : catPrefix;

            tags.set(catPrefix, def.type);
            if (def.subcat) tags.set(propPrefix, def.subtype);   // e.g. train_protection:main=ETCS:stop_marker

            for (const [k, v] of Object.entries(def.properties ?? {})) {
                tags.set(`${propPrefix}:${k}`, v);
            }
            if (networkId) tags.set(`${propPrefix}:ref`, networkId);
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

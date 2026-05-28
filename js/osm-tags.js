/**
 * osm-tags.js - OSM tag generation from SIGNAL_MAPPING entries.
 *
 * Extracts the tag-building logic from signal-mapping.js into a dependency-free
 * module so it can be shared between the main application and the validation tool.
 *
 * signal-mapping.js imports buildNodeTags() and passes a translated fixme string.
 * validate-main.js imports buildNodeTags() with the default English fixme string.
 *
 * No dependency on translation.js, DOM, or any module with side-effects.
 *
 * Public API:
 *   buildNodeTags(feats, opts) -> Map<string, string>
 */

import { SIGNAL_MAPPING }      from './signal-types.js';
import { milepostToDecimalKm } from './sncf-convert.js';

/**
 * Build the complete OSM tag Map for a node group.
 *
 * Tags written for every node:
 *   railway=signal
 *   railway:position:exact    - milepost as decimal km
 *   railway:signal:direction  - forward | backward | both
 *   railway:signal:position   - left | right | bridge
 *
 * For each mapped signal in the group:
 *   railway:signal:<cat>=<type>
 *   railway:signal:<cat>:<property>=<value>   (from mapping.properties)
 *   railway:signal:<cat>:ref=<networkId>
 *
 * For unmapped signals:
 *   fixme=<fixmeLabel> '<type>' (<networkId>)
 *
 * @param {Array<{ p: object }>} feats
 * @param {{ fixmeLabel?: string }} opts
 * @returns {Map<string, string>}
 */
export function buildNodeTags(feats, { fixmeLabel = 'unsupported signal' } = {}) {
    const tags  = new Map();
    const first = feats[0].p;

    tags.set('railway', 'signal');
    tags.set('railway:position:exact', milepostToDecimalKm(first.milepost));
    if (first.direction !== 'unknown') tags.set('railway:signal:direction', first.direction);
    if (first.placement !== 'unknown') tags.set('railway:signal:position',  first.placement);

    const unsupported = new Map();

    for (const feat of feats) {
        const { signalType, networkId } = feat.p;
        const mapping = SIGNAL_MAPPING[signalType];

        if (mapping) {
            const prefix = `railway:signal:${mapping.cat}`;
            tags.set(prefix, mapping.type);
            for (const [k, v] of Object.entries(mapping.properties ?? {})) {
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
        tags.set('fixme', `${fixmeLabel}: ${items.join('; ')}`);
    }

    tags.set('source', 'SNCF - 03/2022');
    return tags;
}

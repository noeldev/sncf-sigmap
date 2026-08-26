// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Noël Danjou

/**
 * netlify/functions/overpass-proxy.js - Server-side Overpass API proxy.
 *
 * Why this exists:
 *   The public Overpass instance rejects requests that look programmatic with
 *   HTTP 406, and it does not attach CORS headers to error responses. A browser
 *   fetch from the deployed origin therefore surfaces as a CORS error whose real
 *   cause is the 406. Forwarding the query server-side fixes both problems:
 *     - the browser only talks to its own origin (/api/overpass), so CORS does
 *       not apply at all;
 *     - a descriptive User-Agent can be set here (browsers forbid overriding it),
 *       which is what the anti-scraper filter expects, so the 406 goes away.
 *
 * Netlify Functions 2.0: ESM entry point, web-standard Request/Response.
 * The exported config.path publishes the function at /api/overpass, so the
 * URL is independent of this file name and no redirect rule is needed.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Descriptive User-Agent with a contact reference, per Overpass etiquette.
// Replace the project URL and contact address before deploying.
const USER_AGENT = 'sncf-sigmap/1.0 (+https://github.com/noeldev/sncf-sigmap; contact: noeld.orm@outlook.com)';

export default async (request) => {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const body = await request.text();

    let upstream;
    try {
        upstream = await fetch(OVERPASS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT,
            },
            body,
        });
    } catch (err) {
        // Network-level failure reaching Overpass (DNS, reset, timeout).
        return _jsonError(502, 'Upstream fetch failed', err.message);
    }

    // Forward the upstream status verbatim so the client retry logic keeps
    // reacting to genuine transient errors (429, 504, ...).
    const payload = await upstream.text();
    return new Response(payload, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
};

/** Build a JSON error response. */
function _jsonError(status, error, detail) {
    return new Response(
        JSON.stringify({ error, detail }),
        { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
}

// Publish the function at a stable, same-origin path (independent of file name).
export const config = {
    path: '/api/overpass',
};

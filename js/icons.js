/**
 * icons.js — Inline SVG icon definitions for toolbar and button icons.
 *
 * Injects a <style> block with CSS mask-image data URIs so that no HTTP
 * requests are made for the icon-*.svg files at runtime. The SVG source
 * files in /assets/svg/ are kept as originals but are no longer referenced
 * by CSS or JS.
 *
 * Icons that are loaded as <img> (josm.svg, osm.svg, flag-*.svg) are not
 * handled here — they carry colour information and cannot be CSS masks.
 *
 * Call injectIconStyles() once at app startup (before the DOM renders icons).
 */

// Raw SVG strings — kept compact, no XML declaration needed for data URIs.
// Using single quotes inside SVG avoids conflicts with the JS template literal.
const _SVG = {
    hamburger:  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor'><rect y='2.5' width='20' height='2' rx='1'/><rect y='9' width='20' height='2' rx='1'/><rect y='15.5' width='20' height='2' rx='1'/></svg>`,
    locate:     `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round'><circle cx='12' cy='12' r='3'/><path d='M12 2v3M12 19v3M2 12h3M19 12h3'/></svg>`,
    fullscreen: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3'/></svg>`,
    'zoom-in':  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg>`,
    'zoom-out': `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round'><line x1='5' y1='12' x2='19' y2='12'/></svg>`,
    copy:       `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='9' width='13' height='13' rx='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>`,
    check:      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>`,
};

/** Encode an SVG string as a CSS url(data:image/svg+xml,…) value. */
function _uri(svg) {
    // Minimal encoding: only characters that would break the CSS url() token.
    // Encoding the full string with encodeURIComponent is safe but larger.
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Inject a <style> element that defines .icon-* mask-image rules using
 * data URIs. Safe to call multiple times — subsequent calls are no-ops.
 */
let _injected = false;
export function injectIconStyles() {
    if (_injected) return;
    _injected = true;

    const rules = [
        `.icon-hamburger  { -webkit-mask-image:${_uri(_SVG.hamburger)};  mask-image:${_uri(_SVG.hamburger)};  width:15px; height:15px; }`,
        `.icon-locate     { -webkit-mask-image:${_uri(_SVG.locate)};     mask-image:${_uri(_SVG.locate)};     width:15px; height:15px; }`,
        `.icon-fullscreen { -webkit-mask-image:${_uri(_SVG.fullscreen)}; mask-image:${_uri(_SVG.fullscreen)}; width:14px; height:14px; }`,
        `.icon-zoom-in    { -webkit-mask-image:${_uri(_SVG['zoom-in'])};  mask-image:${_uri(_SVG['zoom-in'])};  width:14px; height:14px; }`,
        `.icon-zoom-out   { -webkit-mask-image:${_uri(_SVG['zoom-out'])}; mask-image:${_uri(_SVG['zoom-out'])}; width:14px; height:14px; }`,
        `.icon-copy       { -webkit-mask-image:${_uri(_SVG.copy)};       mask-image:${_uri(_SVG.copy)};       width:13px; height:13px; }`,
        `.icon-check      { -webkit-mask-image:${_uri(_SVG.check)};      mask-image:${_uri(_SVG.check)};      width:13px; height:13px; }`,
    ].join('\n');

    const style = document.createElement('style');
    style.id = 'icon-styles';
    style.textContent = rules;
    document.head.appendChild(style);
}

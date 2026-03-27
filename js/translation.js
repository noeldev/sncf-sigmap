/**
 * translation.js — Internationalisation.
 *
 * Strings are loaded from /strings/strings.{locale}.json at boot time.
 * JSON files may be nested objects — they are flattened at load time so that
 * t('values.direction.forward') resolves correctly regardless of structure.
 *
 * Parametric strings use {0}, {1}, … placeholders. Number arguments are
 * formatted with toLocaleString() automatically.
 *
 * HTML patterns:
 *   data-i18n="key"        → el.textContent  (or placeholder for inputs)
 *   data-i18n-html="key"   → el.innerHTML    (only for trusted markup)
 *   data-i18n-title="key"  → el.title
 *   data-i18n-aria="key"   → el.aria-label
 *
 * Public API:
 *   loadStrings(locale)    — fetch and install strings for a locale (with en-us fallback)
 *   t(key, ...args)        — translate a key, substituting {n} placeholders
 *   getLang()              — current locale tag, e.g. 'en-us'
 *   setLang(locale)        — switch locale and reapply all translations
 *   translateElement(root) — apply translations to a DOM subtree
 *   translateAll()         — apply translations to the full live document
 *   onLangChange(fn)       — register a listener called after lang change
 *   buildLangOptions(el)   — populate a dropdown <ul> from _LANG_INFO
 *   cloneTemplate(id, sel) — clone a <template>, translate it, return the root element
 */


/* ===== Language configuration =====
 *
 * Single source of truth for supported locales and their metadata.
 * Locale codes use BCP 47 casing (e.g. 'en-US', 'fr-FR').
 * String file names are derived by lowercasing the code (strings.en-us.json).
 */
const _LANG_INFO = {
    default: 'en-US',
    supported: {
        'en-US': { label: 'English', flag: 'flag-en.svg' },
        'fr-FR': { label: 'Français', flag: 'flag-fr.svg' },
    },
};



let _strings = {};


/* ===== Language picker DOM generation =====
 *
 * Generates .lang-option list items from _LANG_INFO at runtime,
 * replacing any placeholder content in the dropdown.
 * Called once from sidebar.js during initSidebar().
 */

/**
 * Populate a <ul> element with one .lang-option per supported locale.
 * Each item mirrors the structure expected by sidebar.js _updateLangBtn():
 *   <li class='lang-option' data-val='{code}'>
 *     <img src='assets/svg/{flag}' class='flag-img'>
 *     <span>{label}</span>
 *   </li>
 * @param {HTMLElement} listEl  The <ul> dropdown element
 */
export function buildLangOptions(listEl) {
    if (!listEl) return;
    const tpl = document.getElementById('tpl-lang-option');
    if (!tpl) return;
    listEl.replaceChildren();
    for (const [code, { label, flag }] of Object.entries(_LANG_INFO.supported)) {
        const li = tpl.content.cloneNode(true).querySelector('.lang-option');
        li.dataset.val = code;
        const img = li.querySelector('img');
        img.src = `assets/svg/${flag}`;
        img.alt = label;
        li.querySelector('span').textContent = label;
        listEl.appendChild(li);
    }
}

let _lang = _resolveInitialLang();


/* ===== String loading ===== */

/**
 * Fetch and install strings for the given locale.
 * Falls back to the default locale (en-US) when the requested locale
 * cannot be loaded. If the fallback also fails, strings remain empty
 * and t() returns keys verbatim.
 *
 * JSON files may be flat or nested — both are supported via _flatten().
 *
 * @param {string} locale  e.g. 'en-US'
 */
export async function loadStrings(locale) {
    const _load = async loc => {
        const res = await fetch(`./strings/strings.${loc.toLowerCase()}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return _flatten(await res.json());
    };

    try {
        _strings = await _load(locale);
        _lang = locale;
        try {
            localStorage.setItem('lang', locale);
        } catch {
            /* storage blocked */
        }
    } catch (err) {
        console.warn(`[i18n] Failed to load strings.${locale}.json: ${err.message}`);
        if (locale !== _LANG_INFO.default) {
            console.warn(`[i18n] Falling back to ${_LANG_INFO.default}`);
            try {
                _strings = await _load(_LANG_INFO.default);
                _lang = _LANG_INFO.default;
                try {
                    localStorage.setItem('lang', _LANG_INFO.default);
                } catch {
                    /* noop */
                }
            } catch (fallbackErr) {
                console.error('[i18n] Fallback also failed — UI strings will show as keys.');
            }
        }
    }
}

/**
 * Recursively flatten a nested object into dot-path keys.
 * { "values": { "direction": { "forward": "Increasing" } } }
 *   → { "values.direction.forward": "Increasing" }
 * Flat input objects pass through unchanged.
 *
 * @param {object} obj
 * @param {string} prefix
 * @returns {object}
 */
function _flatten(obj, prefix = '') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            Object.assign(result, _flatten(v, key));
        } else {
            result[key] = v;
        }
    }
    return result;
}


/* ===== Core API ===== */

/**
 * Return the current locale code, e.g. 'en-US'.
 * @returns {string}
 */
export function getLang() {
    return _lang;
}

/**
 * Switch the active locale, reload strings, and retranslate the full document.
 * Triggers all onLangChange listeners.
 * @param {string} locale  BCP 47 locale code, e.g. 'fr-FR'.
 * @returns {Promise<void>}
 */
export async function setLang(locale) {
    await loadStrings(locale);
    translateAll();
}

/**
 * Translate a key, substituting {0}, {1}, … with the provided arguments.
 * Number arguments are formatted with toLocaleString() for locale-aware display.
 * Returns the key itself when no translation is found.
 *
 * @param {string} key
 * @param {...*}   args  Substitution values
 * @returns {string}
 */
export function t(key, ...args) {
    const str = _strings[key] ?? key;
    if (!args.length) return str;
    return str.replace(/\{(\d+)\}/g, (_, i) => {
        const v = args[+i];
        return typeof v === 'number' ? v.toLocaleString() : (v ?? '');
    });
}


/* ===== DOM translation ===== */

/**
 * Apply translations to every data-i18n* element within a given root.
 * Works on any DOM subtree — including freshly cloned template content.
  * @param {Element} root
*/
export function translateElement(root) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const val = t(el.dataset.i18n);
        if (el.tagName === 'INPUT') el.placeholder = val;
        else {
            el.textContent = val;
            if (el.tagName === 'TITLE') document.title = val;
        }
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = t(el.dataset.i18nHtml);  // trusted markup only
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => {
        el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
}

/**
 * Translate the full live document and broadcast the language change
 * to all onLangChange listeners.
 * Listeners are responsible for re-rendering their own dynamic content.
 * Called once by setLang() and once by app.js after initial string load.
 */
export function translateAll() {
    translateElement(document.documentElement);
    document.documentElement.lang = _lang;
    _langListeners.forEach(fn => fn());
}

/**
 * Register a callback invoked after every language change.
 * Called immediately after strings are reloaded and the document is retranslated.
 * @param {Function} fn
 */
const _langListeners = [];
export function onLangChange(fn) {
    _langListeners.push(fn);
}


/* ===== Private helpers ===== */

function _resolveInitialLang() {
    const _supported = Object.keys(_LANG_INFO.supported);
    try {
        const stored = localStorage.getItem('lang');
        if (stored && _supported.includes(stored)) return stored;
    } catch {
        /* storage blocked */
    }
    // Auto-detect from browser language; fall back to default.
    const browser = navigator.language.toLowerCase();
    return _supported.find(code => browser.startsWith(code.split('-')[0]))
        ?? _LANG_INFO.default;
}

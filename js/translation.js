/**
 * translation.js — Internationalisation.
 *
 * Strings are loaded from /strings/strings.{locale}.json at boot time.
 * JSON files may be nested objects — they are flattened at load time so that
 * t('values.direction.forward') resolves correctly regardless of structure.
 *
 * HTML patterns:
 *   data-i18n="key"        → el.textContent (or placeholder for inputs) — plain text only
 *   data-i18n-html="key"   → el.innerHTML — may contain precompiled markup
 *   data-i18n-title="key"  → el.title
 *   data-i18n-aria="key"   → el.aria-label
 *
 * Internal tab links are styled via the CSS selector a[data-switch-tab] and
 * activated by a delegated click listener registered in sidebar.js.
 *
 * Public API:
 *   loadStrings(locale)    — fetch and install strings for a locale (en-US fallback)
 *   t(key, ...args)        — translate a key, substituting {n} placeholders
 *   getLang()              — current locale tag, e.g. 'en-US'
 *   setLang(locale)        — switch locale and reapply all translations
 *   translateElement(root) — apply translations to a DOM subtree
 *   translateAll()         — apply translations to the full live document
 *   onLangChange(fn)       — register a listener called after lang change
 *   buildLangOptions(el)   — populate a dropdown <ul> from LANG_INFO
 */

import { getLangPref, setLangPref } from './prefs.js';
import { isMarkup, toHtml } from './markup.js';
import { Observable } from './utils/observable.js';

// ===== Precompiled regular expressions =====

const RE_PLACEHOLDER = /\{(\d+)\}/g;


/* ===== Language configuration =====
 *
 * Single source of truth for supported locales and their metadata.
 * Locale codes use BCP 47 casing (e.g. 'en-US', 'fr-FR').
 * String file names are derived by lowercasing the code (strings.en-us.json).
 */

const LANG_INFO = {
    default: 'en-US',
    supported: {
        'en-US': { label: 'English', flag: 'flag-en.svg' },
        'fr-FR': { label: 'Français', flag: 'flag-fr.svg' },
    },
};

const _langChange = new Observable();

let _strings = {};


/* ===== Language picker DOM generation =====
 *
 * Generates .lang-option list items from LANG_INFO at runtime,
 * replacing any placeholder content in the dropdown.
 * Called once from sidebar.js during initSidebar().
 */

/**
 * Populate a <ul> element with one .lang-option per supported locale.
 * @param {HTMLElement} listEl  The <ul> dropdown element.
 */
export function buildLangOptions(listEl) {
    if (!listEl) return;
    const tpl = document.getElementById('tpl-lang-option');
    if (!tpl) return;
    listEl.replaceChildren();
    for (const [code, { label, flag }] of Object.entries(LANG_INFO.supported)) {
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


// ===== String loading =====

/**
 * Fetch and install strings for the given locale.
 * Falls back to en-US when the requested locale cannot be loaded.
 *
 * Pipeline: fetch JSON → _flatten() → _precompileAllMarkup() → _strings.
 * After this call, every value is either plain text or a pre-built HTML string.
 *
 * @param {string} locale  BCP 47 locale code, e.g. 'en-US'.
 * @returns {Promise<void>}
 */
export async function loadStrings(locale) {
    const _load = async loc => {
        const res = await fetch(`./strings/strings.${loc.toLowerCase()}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return _precompileAllMarkup(_flatten(await res.json()));
    };

    try {
        _strings = await _load(locale);
        _lang = locale;
        setLangPref(locale);
    } catch (err) {
        console.warn(`[i18n] Failed to load strings.${locale}.json: ${err.message}`);
        if (locale !== LANG_INFO.default) {
            console.warn(`[i18n] Falling back to ${LANG_INFO.default}`);
            try {
                _strings = await _load(LANG_INFO.default);
                _lang = LANG_INFO.default;
                setLangPref(LANG_INFO.default);
            } catch {
                console.error('[i18n] Fallback also failed — UI strings will show as keys.');
            }
        }
    }
}

/**
 * Recursively flatten a nested object into dot-path keys.
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
        } else if (Array.isArray(v)) {
            // String arrays are joined with newlines so they are handled as a single
            // multiline markup string by _precompileAllMarkup / markup.js.
            result[key] = v.join('\n');
        } else {
            result[key] = v;
        }
    }
    return result;
}

/**
 * Precompile all markup patterns in a flattened strings object into HTML strings.
 * Delegates detection and conversion to markup.js.
 * Strings without markup are passed through unchanged.
 * Called once per locale load.
 *
 * @param {object} strings  Flat key→value strings object from _flatten().
 * @returns {object}        Same shape; markup strings replaced by HTML strings.
 */
function _precompileAllMarkup(strings) {
    const result = {};
    for (const [key, val] of Object.entries(strings)) {
        result[key] = typeof val === 'string' && isMarkup(val) ? toHtml(val) : val;
    }
    return result;
}


// ===== Core API =====

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
 * @param {...*}   args  Substitution values.
 * @returns {string}
 */

export function t(key, ...args) {
    const str = _strings[key] ?? key;
    if (!args.length) return str;
    return str.replace(RE_PLACEHOLDER, (_, i) => {
        const v = args[+i];
        return typeof v === 'number' ? v.toLocaleString() : (v ?? '');
    });
}


// ===== DOM translation =====

/**
 * Apply translations to every data-i18n* element within a given root.
 * Works on any DOM subtree — including freshly cloned template content.
 *
 * data-i18n      — plain text; sets el.textContent (or el.placeholder for inputs).
 * data-i18n-html — may contain precompiled markup; sets el.innerHTML directly.
 *
 * @param {Element} root
 */
export function translateElement(root) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const val = t(el.dataset.i18n);
        if (el.tagName === 'INPUT') {
            el.placeholder = val;
        } else {
            el.textContent = val;
            if (el.tagName === 'TITLE') {
                document.title = val;
            }
        }
    });
    // data-i18n-html: innerHTML is safe — markup was precompiled from trusted
    // string files at load time, never from user input.
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = t(el.dataset.i18nHtml);
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
 * Called once by setLang() and once by app.js after initial string load.
 */
export function translateAll() {
    translateElement(document.documentElement);
    _langChange.notify();
    document.documentElement.lang = _lang;
}

/**
 * Register a callback invoked after every language change.
 * @param {Function} fn
 */

export function onLangChange(fn) {
    return _langChange.subscribe(fn);
}


// ===== Private helpers =====

function _resolveInitialLang() {
    const _supported = Object.keys(LANG_INFO.supported);
    const stored = getLangPref();
    if (stored && _supported.includes(stored)) return stored;
    const browser = navigator.language.toLowerCase();
    return _supported.find(code => browser.startsWith(code.split('-')[0]))
        ?? LANG_INFO.default;
}

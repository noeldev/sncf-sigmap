/**
 * i18n.js — Internationalisation.
 * All user-visible strings are defined here.
 *
 * Usage:
 *   import { t, setLang, applyTranslations } from './i18n.js'
 *
 * HTML pattern: <div data-i18n="key">Fallback text</div>
 *   The inline fallback is intentional — it is shown before JS runs (no flash
 *   of untranslated content). applyTranslations() overwrites it immediately.
 *   Use data-i18n-html for strings containing HTML markup.
 *   Use data-i18n-title for title attributes.
 */

export const LANGS = [
  { code: 'en', label: 'English'  },
  { code: 'fr', label: 'Français' },
];

const STRINGS = {
  en: {
    // Sidebar header
    'subtitle1': 'Signalisation',
    'subtitle2': 'Permanente',
    'loading':   'Loading…',

    // Tabs
    'tab.filters':  'Filters',
    'tab.settings': 'Settings',
    'tab.about':    'About',

    // Filter toolbar
    'btn.addFilter':    '+ Add filter',
    'btn.reset':        'Reset',
    'toggle.supported': 'Supported only',

    // Legend
    'legend.title': 'Legend',

    // Filter field labels
    'field.type_if':    'TYPE IF',
    'field.code_ligne': 'CODE LIGNE',
    'field.nom_voie':   'NOM VOIE',
    'field.sens':       'SENS',
    'field.position':   'POSITION',

    // Dropdown
    'dropdown.search':  n => `Search ${n} values…`,
    'dropdown.noMatch': 'No matching values',
    'dropdown.remove':  'Remove filter',

    // Settings
    'settings.basemap':  'Base Map',
    'settings.language': 'Language',

    // Basemap names
    'basemap.jawg':      'Jawg Transport',
    'basemap.osm':       'OpenStreetMap',
    'basemap.satellite': 'Satellite',

    // Controls
    'ctrl.toggle':     'Toggle panel',
    'ctrl.zoomIn':     'Zoom in',
    'ctrl.zoomOut':    'Zoom out',
    'ctrl.locate':     'My location',
    'ctrl.fullscreen': 'Fullscreen',

    // Status bar
    'status.signals': 'Signals',
    'status.filters': 'Filters',
    'status.zoom':    'Zoom',

    // Progress messages
    'progress.index':     'Loading index…',
    'progress.tiles':     n => `Loading ${n} tile(s)…`,
    'progress.filtering': 'Filtering…',

    // Popup
    'popup.of':       'of',
    'popup.osmTags':  n => n > 1 ? `OSM tags (${n} signals)` : 'OSM tags',
    'popup.merged':   n => `Tags merged for ${n} co-located signals`,
    'popup.copy':     'Copy tags',
    'popup.josm':     'Open in JOSM',
    'popup.copied':   'Copied!',
    'popup.josmSent': 'Sent to JOSM',

    // OSM existence check
    'osm.checking':   'Checking in OpenStreetMap…',
    'osm.inOsm':      'Already in OpenStreetMap',
    'osm.notInOsm':   'Not yet in OpenStreetMap',
    'osm.error':      'OSM check failed (network error)',
    'osm.warnSingle': 'This signal appears to already be in OpenStreetMap. Export anyway?',
    'osm.warnMulti':  'One or more signals in this group appear to already be in OpenStreetMap. Export anyway?',

    // Signal groups (legend)
    'group.main':     'Main signals',
    'group.distant':  'Distant signals',
    'group.speed':    'Speed limits',
    'group.route':    'Route indicators',
    'group.stop':     'Stops & infrastructure',
    'group.crossing': 'Level crossings',
    'group.unknown':  'Unsupported types',

    // About
    'about.intro':         'Viewer for <strong>SNCF permanent railway signalling</strong> open data, with OSM integration via JOSM or clipboard.',
    'about.usage.title':   'How to use',
    'about.usage.text':    'Zoom in to load signals. At low zoom only major types are shown; zoom ≥10 displays all types in the viewport. Click any marker to view properties and export OSM tags.',
    'about.links.title':   'Links',
    'about.credits.title': 'Credits',
    'about.credits':       'Site © 2026 Noël Danjou<br>Data © 2022 SNCF Réseau — <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte</a><br>Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
  },

  fr: {
    'subtitle1': 'Signalisation',
    'subtitle2': 'Permanente',
    'loading':   'Chargement…',

    'tab.filters':  'Filtres',
    'tab.settings': 'Paramètres',
    'tab.about':    'À propos',

    'btn.addFilter':    '+ Ajouter',
    'btn.reset':        'Réinitialiser',
    'toggle.supported': 'Supportés uniquement',

    'legend.title': 'Légende',

    'field.type_if':    'TYPE IF',
    'field.code_ligne': 'CODE LIGNE',
    'field.nom_voie':   'NOM VOIE',
    'field.sens':       'SENS',
    'field.position':   'POSITION',

    'dropdown.search':  n => `Rechercher parmi ${n} valeurs…`,
    'dropdown.noMatch': 'Aucune valeur',
    'dropdown.remove':  'Supprimer le filtre',

    'settings.basemap':  'Fond de carte',
    'settings.language': 'Langue',

    'basemap.jawg':      'Jawg Transport',
    'basemap.osm':       'OpenStreetMap',
    'basemap.satellite': 'Satellite',

    'ctrl.toggle':     'Afficher/masquer le panneau',
    'ctrl.zoomIn':     'Zoom avant',
    'ctrl.zoomOut':    'Zoom arrière',
    'ctrl.locate':     'Ma position',
    'ctrl.fullscreen': 'Plein écran',

    'status.signals': 'Signaux',
    'status.filters': 'Filtres',
    'status.zoom':    'Zoom',

    'progress.index':     'Chargement de l\'index…',
    'progress.tiles':     n => `Chargement de ${n} tuile(s)…`,
    'progress.filtering': 'Filtrage…',

    'popup.of':       'sur',
    'popup.osmTags':  n => n > 1 ? `Tags OSM (${n} signaux)` : 'Tags OSM',
    'popup.merged':   n => `Tags fusionnés pour ${n} signaux co-localisés`,
    'popup.copy':     'Copier les tags',
    'popup.josm':     'Ouvrir dans JOSM',
    'popup.copied':   'Copié !',
    'popup.josmSent': 'Envoyé à JOSM',

    'osm.checking':   'Vérification dans OpenStreetMap…',
    'osm.inOsm':      'Déjà dans OpenStreetMap',
    'osm.notInOsm':   'Pas encore dans OpenStreetMap',
    'osm.error':      'Échec de la vérification OSM (erreur réseau)',
    'osm.warnSingle': 'Ce signal semble déjà être dans OpenStreetMap. Exporter quand même ?',
    'osm.warnMulti':  'Un ou plusieurs signaux de ce groupe semblent déjà être dans OpenStreetMap. Exporter quand même ?',

    'group.main':     'Signaux principaux',
    'group.distant':  'Signaux de reprise',
    'group.speed':    'Limitations de vitesse',
    'group.route':    'Indicateurs de voie',
    'group.stop':     'Arrêts & infrastructures',
    'group.crossing': 'Passages à niveau',
    'group.unknown':  'Types non supportés',

    'about.intro':         'Visualisation des données open data de la <strong>signalisation permanente SNCF</strong> avec intégration OSM via JOSM ou presse-papiers.',
    'about.usage.title':   'Utilisation',
    'about.usage.text':    'Zoomez pour charger les signaux. En vue d\'ensemble, seuls les types principaux sont affichés ; zoom ≥10 affiche tous les types dans la vue. Cliquez sur un marqueur pour voir ses propriétés et exporter les tags OSM.',
    'about.links.title':   'Liens',
    'about.credits.title': 'Crédits',
    'about.credits':       'Site © 2026 Noël Danjou<br>Données © 2022 SNCF Réseau — <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte</a><br>Fond de carte © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
  },
};

let _lang = localStorage.getItem('sncf-lang')
  || (navigator.language.startsWith('fr') ? 'fr' : 'en');

export function getLang() { return _lang; }
export function setLang(l) {
  _lang = l;
  localStorage.setItem('sncf-lang', l);
  applyTranslations();
}

/** Translate a key; calls it if it is a function (parametric strings). */
export function t(key, ...args) {
  const val = STRINGS[_lang]?.[key] ?? STRINGS['en']?.[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

/**
 * Apply translations to every [data-i18n] element.
 * Inline text in HTML is the no-JS fallback; this function overwrites it immediately.
 */
export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = t(el.dataset.i18n);
    if (el.tagName === 'INPUT') el.placeholder = val;
    else el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.documentElement.lang = _lang;
  document.querySelectorAll('.lang-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.lang === _lang);
  });
}

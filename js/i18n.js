/**
 * i18n.js — Internationalisation.
 * All user-visible strings are defined here.
 *
 * Usage:
 *   import { t, setLang, applyTranslations } from './i18n.js'
 *
 * HTML pattern: <div data-i18n="key">Fallback text</div>
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
    'popup.prev':     'Previous signal',
    'popup.next':     'Next signal',
    'popup.close':    'Close',
    'popup.viewOnOsm':'View on OpenStreetMap',

    // OSM existence check
    'osm.checking':   'Checking in OpenStreetMap…',
    'osm.inOsm':      'Already in OpenStreetMap',
    'osm.notInOsm':   'Not yet in OpenStreetMap',
    'osm.error':      'OSM check failed (network error)',
    'osm.retry':      'Retry OSM check',
    'osm.warnSingle': 'This signal appears to already be in OpenStreetMap. Export anyway?',
    'osm.warnMulti':  'One or more signals in this group appear to already be in OpenStreetMap. Export anyway?',

    // Display categories (legend)
    'cat.main':             'Main signals',
    'cat.distant':          'Distant signals',
    'cat.speed_limit':      'Speed limits',
    'cat.route':            'Route indicators',
    'cat.stop':             'Stop signals',
    'cat.shunting':         'Shunting',
    'cat.crossing':         'Level crossings',
    'cat.electricity':      'Traction electricity',
    'cat.train_protection': 'Cab signalling / ETCS',
    'cat.wrong_road':       'Wrong-road (IPCS)',
    'cat.station':          'Station and facilities',
    'cat.miscellaneous':    'Miscellaneous',
    'cat.unsupported':      'Unsupported types',

    // About
    'about.intro':         'Viewer for <strong>SNCF permanent railway signalling</strong> open data, with OSM integration via JOSM or clipboard.',
    'about.usage.title':   'How to use',
    'about.usage.text':    'Zoom in to load signals. At low zoom, results are spatially sampled to keep the map readable; zoom ≥10 shows all signals in the viewport without limit. Active filters always apply regardless of zoom level. Click any marker to view properties and export OSM tags.',
    'about.links.title':   'Links',
    'about.credits.title': 'Credits',
    'about.credits': 'Site © 2026 Noël Danjou<br>Data © 2022 SNCF Réseau — <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte</a><br>Maps © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',

    // Record count (lowercase for inline use)
    'status.signals_lower': 'signals',
    'status.tiles_lower':   'tiles',
  },


  fr: {
      // Sidebar header
    'subtitle1': 'Signalisation',
    'subtitle2': 'Permanente',
    'loading':   'Chargement…',

      // Tabs
    'tab.filters':  'Filtres',
    'tab.settings': 'Paramètres',
    'tab.about':    'À propos',

    // Filter toolbar
    'btn.addFilter':    '+ Ajouter',
    'btn.reset':        'Réinitialiser',
    'toggle.supported': 'Supportés uniquement',

    // Legend
    'legend.title': 'Légende',

    // Filter field labels
    'field.type_if':    'TYPE IF',
    'field.code_ligne': 'CODE LIGNE',
    'field.nom_voie':   'NOM VOIE',
    'field.sens':       'SENS',
    'field.position':   'POSITION',

    // Dropdown
    'dropdown.search':  n => `Rechercher parmi ${n} valeurs…`,
    'dropdown.noMatch': 'Aucune valeur',
    'dropdown.remove':  'Supprimer le filtre',

    // Settings
    'settings.basemap':  'Fond de carte',
    'settings.language': 'Langue',

    // Basemap names
    'basemap.jawg':      'Jawg Transport',
    'basemap.osm':       'OpenStreetMap',
    'basemap.satellite': 'Satellite',

    // Controls
    'ctrl.toggle':     'Afficher/masquer le panneau',
    'ctrl.zoomIn':     'Zoom avant',
    'ctrl.zoomOut':    'Zoom arrière',
    'ctrl.locate':     'Ma position',
    'ctrl.fullscreen': 'Plein écran',

    // Status bar
    'status.signals': 'Signaux',
    'status.filters': 'Filtres',
    'status.zoom':    'Zoom',

    // Progress messages
    'progress.index':     'Chargement de l\'index…',
    'progress.tiles':     n => `Chargement de ${n} tuile(s)…`,
    'progress.filtering': 'Filtrage…',

    // Popup
    'popup.of':       'sur',
    'popup.osmTags':  n => n > 1 ? `Tags OSM (${n} signaux)` : 'Tags OSM',
    'popup.merged':   n => `Tags fusionnés pour ${n} signaux co-localisés`,
    'popup.copy':     'Copier les tags',
    'popup.josm':     'Ouvrir dans JOSM',
    'popup.copied':   'Copié !',
    'popup.josmSent': 'Envoyé à JOSM',
    'popup.prev':     'Signal précédent',
    'popup.next':     'Signal suivant',
    'popup.close':    'Fermer',
    'popup.viewOnOsm':'Voir sur OpenStreetMap',

    // OSM existence check
    'osm.checking':   'Vérification dans OpenStreetMap…',
    'osm.inOsm':      'Déjà dans OpenStreetMap',
    'osm.notInOsm':   'Pas encore dans OpenStreetMap',
    'osm.error':      'Échec de la vérification OSM (erreur réseau)',
    'osm.retry':      'Relancer la vérification OSM',
    'osm.warnSingle': 'Ce signal semble déjà présent dans OpenStreetMap. Exporter quand même ?',
    'osm.warnMulti':  'Un ou plusieurs signaux de ce groupe semblent déjà présents dans OpenStreetMap. Exporter quand même ?',

    // Display categories (legend)
    'cat.main':             'Signaux principaux',
    'cat.distant':          'Signaux distants',
    'cat.speed_limit':      'Limitations de vitesse',
    'cat.route':            'Indicateurs de direction',
    'cat.stop':             'Signaux d\'arrêt',
    'cat.shunting':         'Manœuvres',
    'cat.crossing':         'Passages à niveau',
    'cat.electricity':      'Traction électrique',
    'cat.train_protection': 'Signalisation cabine / ETCS',
    'cat.wrong_road':       'Contre-sens (IPCS)',
    'cat.station':          'Gares et établissements',
    'cat.miscellaneous':    'Divers',
    'cat.unsupported':      'Types non supportés',

    // About
    'about.intro':         'Visualisation des données open data de la <strong>signalisation permanente SNCF</strong> avec intégration OSM via JOSM ou presse-papiers.',
    'about.usage.title':   'Utilisation',
    'about.usage.text':    'Zoomez pour charger les signaux. À faible zoom, les résultats sont spatialement échantillonnés pour garder la carte lisible ; zoom ≥10 affiche tous les signaux dans la vue sans limite. Les filtres actifs s\'appliquent toujours quel que soit le zoom. Cliquez sur un marqueur pour voir ses propriétés et exporter les tags OSM.',
    'about.links.title':   'Liens',
    'about.credits.title': 'Crédits',
    'about.credits': 'Site © 2026 Noël Danjou<br>Données © 2022 SNCF Réseau — <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte</a><br>Cartes © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',

    // Record count (lowercase for inline use)
    'status.signals_lower': 'signaux',
    'status.tiles_lower':   'tuiles',
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
  // Refresh the record count if already loaded (avoid reverting to "Loading…")
  if (window._sncfRecordCount) {
    const { totalSignals, tileCount } = window._sncfRecordCount;
    const el = document.getElementById('record-count');
    if (el) el.textContent = `${totalSignals.toLocaleString()} ${t('status.signals_lower')} — ${tileCount} ${t('status.tiles_lower')}`;
  }
  // Notify registered listeners (e.g. filters panel) of the language change
  _langListeners.forEach(fn => fn());
}

const _langListeners = [];
/** Register a callback to be called whenever the active language changes. */
export function onLangChange(fn) { _langListeners.push(fn); }

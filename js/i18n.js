/**
 * i18n.js — Internationalisation.
 * All user-visible strings are defined here.
 *
 * HTML patterns:
 *   data-i18n="key"        → el.textContent  (or placeholder for inputs)
 *   data-i18n-html="key"   → el.innerHTML    (only for trusted markup)
 *   data-i18n-title="key"  → el.title
 *   data-i18n-aria="key"   → el.aria-label
 *
 * Use complete sentences rather than fragments assembled by concatenation,
 * so that word order remains correct in every language.
 */

export const LANGS = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
];

const STRINGS = {
    en: {
        // Page title
        'page.title': 'SNCF Fixed Signalling',

        // Sidebar header
        'subtitle1': 'Fixed',
        'subtitle2': 'Signalling',
        'loading': 'Loading…',

        // Tabs
        'tab.filters': 'Filters',
        'tab.settings': 'Settings',
        'tab.about': 'About',

        // Filter toolbar
        'btn.addFilter': '+ Add filter',
        'btn.reset': 'Reset',
        'toggle.supported': 'Supported types only',

        // Legend
        'legend.title': 'Legend',

        // Filter field labels
        'field.type_if': 'TYPE IF',
        'field.code_ligne': 'CODE LIGNE',
        'field.nom_voie': 'NOM VOIE',
        'field.sens': 'SENS',
        'field.position': 'POSITION',
        'field.idreseau': 'ID RÉSEAU',

        'filter.indexError': 'Filter index unavailable — suggestions may be incomplete.',

        // Dropdown (for other filterable fields)
        'dropdown.search': n => `Search among ${n} values\u2026`,
        'dropdown.noMatch': 'No matching values',
        'dropdown.remove': 'Remove filter',

        // Settings
        'settings.basemap': 'Base Map',
        'settings.language': 'Language',

        // Basemap names
        'basemap.jawg': 'Jawg Transport',
        'basemap.osm': 'OpenStreetMap',
        'basemap.satellite': 'Satellite',

        // Controls
        'ctrl.toggle': 'Toggle panel',
        'ctrl.zoomIn': 'Zoom in',
        'ctrl.zoomOut': 'Zoom out',
        'ctrl.locate': 'My location',
        'ctrl.fullscreen': 'Fullscreen',

        // Status bar
        'status.signals': 'Signals',
        'status.filters': 'Filters',
        'status.zoom': 'Zoom',
        'status.sampled_title': (total, minZoom) =>
            `Overview sample — ${total.toLocaleString()} matching signals. Zoom ≥${minZoom} for full detail.`,

        // Progress messages
        'progress.index': 'Loading index…',
        'progress.tiles': n => `Loading ${n} tile(s)…`,
        'progress.filtering': 'Filtering…',

        // Popup — use complete sentences to keep word order correct across languages
        'popup.navLabel': (idx, total) => `${idx} / ${total}`,
        'popup.nodeLabel': (idx, total) => `${idx}\u2009/\u2009${total}`,
        'popup.nodeNone': 'No mapping',
        'popup.nodePending': n => `\u00b7 ${n} to export`,
        'popup.nodeAllExported': 'All exported',
        'popup.nodeExported': 'Already sent to JOSM',
        'popup.previewTags': 'Preview OSM tags',
        'popup.osmTags': 'OSM Tags',
        'popup.copy': 'Copy tags',
        'popup.josm': 'Open in JOSM',
        'popup.copied': 'Copied!',
        'popup.josmSent': 'Sent to JOSM',
        'popup.prev': 'Previous signal',
        'popup.next': 'Next signal',
        'popup.close': 'Close',
        'popup.copyPrompt': 'Copy OSM tags',

        // OSM existence check
        'osm.locateOnOsm': 'Locate on OpenStreetMap',
        'osm.checking': 'Checking in OpenStreetMap\u2026',
        'osm.inOsm': nodeId => `In OpenStreetMap \u2014 Node\u00a0#${nodeId}`,
        'osm.notInOsm': 'Not yet in OpenStreetMap',
        'osm.error': 'OSM check failed',
        'osm.retry': 'Retry OSM check',
        'osm.warnAlreadyExported': 'This node was already sent to JOSM this session. Send again?',
        'osm.warnSingle': 'This signal appears to already be in OpenStreetMap. Export anyway?',
        'osm.warnMulti': 'One or more signals in this group appear to already be in OpenStreetMap. Export anyway?',

        // JOSM errors
        'josm.notReachable': 'JOSM not reachable',

        // Display categories (legend)
        'cat.main': 'Main signals',
        'cat.distant': 'Distant signals',
        'cat.speed_limit': 'Speed limits',
        'cat.route': 'Route indicators',
        'cat.stop': 'Stop signs',
        'cat.shunting': 'Shunting',
        'cat.crossing': 'Level crossings',
        'cat.electricity': 'Traction electricity',
        'cat.train_protection': 'Cab signalling / ETCS',
        'cat.wrong_road': 'Wrong-road (IPCS)',
        'cat.station': 'Station and facilities',
        'cat.miscellaneous': 'Miscellaneous',
        'cat.unsupported': 'Unsupported types',

        // About
        'about.intro': 'Viewer for <strong>SNCF Signalisation Permanente</strong> (Fixed Signalling) open data, with OSM integration via JOSM or clipboard.',
        'about.usage.title': 'How to use',
        'about.usage.text': 'Zoom in to load signals. At low zoom, results are spatially sampled to keep the map readable; zoom ≥10 shows all signals in the viewport without limit. Active filters always apply regardless of zoom level. Click any marker to view properties and export OSM tags.',
        'about.links.title': 'Links',
        'about.credits.title': 'Credits',
        'about.credits': 'Site © 2026 Noël Danjou<br>Data © 2022 SNCF Réseau — <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte</a><br>Maps © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',

        // Record count
        'status.signals_lower': 'signals',
        'status.tiles_lower': 'tiles',

        // JOSM detection panel (Settings tab)
        'josm.detect.title': 'JOSM',
        'josm.detect.version': 'Version',
        'josm.detect.protocol': 'Protocol',
        'josm.detect.port': 'Port',
        'josm.detect.checking': '…',
        'josm.detect.notDetected': 'Not detected',
        'josm.detect.notAllowed': 'Not allowed yet',
    },

    fr: {
        // Page title
        'page.title': 'SNCF Signalisation Permanente',

        // Sidebar header
        'subtitle1': 'Signalisation',
        'subtitle2': 'Permanente',
        'loading': 'Chargement…',

        // Tabs
        'tab.filters': 'Filtres',
        'tab.settings': 'Paramètres',
        'tab.about': 'À propos',

        // Filter toolbar
        'btn.addFilter': '+ Ajouter',
        'btn.reset': 'Réinitialiser',
        'toggle.supported': 'Types supportés uniquement',

        // Legend
        'legend.title': 'Légende',

        // Filter field labels
        'field.type_if': 'TYPE IF',
        'field.code_ligne': 'CODE LIGNE',
        'field.nom_voie': 'NOM VOIE',
        'field.sens': 'SENS',
        'field.position': 'POSITION',
        'field.idreseau': 'ID RÉSEAU',

        'filter.indexError': 'Index des filtres indisponible — les suggestions peuvent être incomplètes.',

        // Dropdown (pour les autres champs filtrables)
        'dropdown.search': n => `Rechercher parmi ${n} valeurs\u2026`,
        'dropdown.noMatch': 'Aucune valeur',
        'dropdown.remove': 'Supprimer le filtre',

        // Settings
        'settings.basemap': 'Fond de carte',
        'settings.language': 'Langue',

        // Basemap names
        'basemap.jawg': 'Jawg Transport',
        'basemap.osm': 'OpenStreetMap',
        'basemap.satellite': 'Satellite',

        // Controls
        'ctrl.toggle': 'Afficher/masquer le panneau',
        'ctrl.zoomIn': 'Zoom avant',
        'ctrl.zoomOut': 'Zoom arrière',
        'ctrl.locate': 'Afficher mon emplacement',
        'ctrl.fullscreen': 'Plein écran',

        // Status bar
        'status.signals': 'Signaux',
        'status.filters': 'Filtres',
        'status.zoom': 'Zoom',
        'status.sampled_title': (total, minZoom) =>
            `Aperçu — ${total.toLocaleString()} signaux correspondants. Zoom ≥${minZoom} pour le détail complet.`,

        // Progress messages
        'progress.index': 'Chargement de l\'index…',
        'progress.tiles': n => `Chargement de ${n} tuile(s)…`,
        'progress.filtering': 'Filtrage…',

        // Popup — phrases complètes pour respecter l'ordre des mots
        'popup.navLabel': (idx, total) => `${idx} / ${total}`,
        'popup.nodeLabel': (idx, total) => `${idx}\u2009/\u2009${total}`,
        'popup.nodeNone': 'Pas de correspondance',
        'popup.nodePending': n => `\u00b7 ${n} \u00e0 exporter`,
        'popup.nodeAllExported': 'Tout export\u00e9',
        'popup.nodeExported': 'D\u00e9j\u00e0 envoy\u00e9 \u00e0 JOSM',
        'popup.previewTags': 'Pr\u00e9visualiser les tags OSM',
        'popup.osmTags': 'Tags OSM',
        'popup.copy': 'Copier les tags',
        'popup.josm': 'Ouvrir dans JOSM',
        'popup.copied': 'Copi\u00e9\u00a0!',
        'popup.josmSent': 'Envoy\u00e9 \u00e0 JOSM',
        'popup.prev': 'Signal pr\u00e9c\u00e9dent',
        'popup.next': 'Signal suivant',
        'popup.close': 'Fermer',
        'popup.copyPrompt': 'Copier les tags OSM',

        // OSM existence check
        'osm.locateOnOsm': 'Localiser dans OpenStreetMap',
        'osm.checking': 'V\u00e9rification dans OpenStreetMap\u2026',
        'osm.inOsm': nodeId => `Dans OpenStreetMap \u2014 N\u0153ud\u00a0#${nodeId}`,
        'osm.notInOsm': 'Pas encore dans OpenStreetMap',
        'osm.error': '\u00c9chec de la v\u00e9rification OSM',
        'osm.retry': 'Relancer la v\u00e9rification OSM',
        'osm.warnAlreadyExported': 'Ce n\u0153ud a d\u00e9j\u00e0 \u00e9t\u00e9 envoy\u00e9 \u00e0 JOSM cette session. Envoyer \u00e0 nouveau\u00a0?',
        'osm.warnSingle': 'Ce signal semble d\u00e9j\u00e0 pr\u00e9sent dans OpenStreetMap. Exporter quand m\u00eame\u00a0?',
        'osm.warnMulti': 'Un ou plusieurs signaux semblent d\u00e9j\u00e0 pr\u00e9sents dans OpenStreetMap. Exporter quand m\u00eame\u00a0?',

        // JOSM errors
        'josm.notReachable': 'JOSM inaccessible',

        // Display categories (legend)
        'cat.main': 'Signaux principaux',
        'cat.distant': 'Signaux distants',
        'cat.speed_limit': 'Limitations de vitesse',
        'cat.route': 'Indicateurs de direction',
        'cat.stop': 'Pancartes d\'arrêt',
        'cat.shunting': 'Manœuvres',
        'cat.crossing': 'Passages à niveau',
        'cat.electricity': 'Traction électrique',
        'cat.train_protection': 'Signalisation cabine / ETCS',
        'cat.wrong_road': 'Contre-sens (IPCS)',
        'cat.station': 'Gares et établissements',
        'cat.miscellaneous': 'Divers',
        'cat.unsupported': 'Types non supportés',

        // About
        'about.intro': 'Visualisation des données open data <strong>SNCF Signalisation Permanente</strong> avec intégration OSM via JOSM ou presse-papiers.',
        'about.usage.title': 'Utilisation',
        'about.usage.text': 'Zoomez pour charger les signaux. À faible zoom, les résultats sont spatialement échantillonnés pour garder la carte lisible ; zoom ≥10 affiche tous les signaux dans la vue sans limite. Les filtres actifs s\'appliquent toujours quel que soit le zoom. Cliquez sur un marqueur pour voir ses propriétés et exporter les tags OSM.',
        'about.links.title': 'Liens',
        'about.credits.title': 'Crédits',
        'about.credits': 'Site © 2026 Noël Danjou<br>Données © 2022 SNCF Réseau — <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte</a><br>Cartes © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',

        // Record count
        'status.signals_lower': 'signaux',
        'status.tiles_lower': 'tuiles',

        // JOSM detection panel (Settings tab)
        'josm.detect.title': 'JOSM',
        'josm.detect.version': 'Version',
        'josm.detect.protocol': 'Protocole',
        'josm.detect.port': 'Port',
        'josm.detect.checking': '…',
        'josm.detect.notDetected': 'Non détecté',
        'josm.detect.notAllowed': 'Non autorisé',
    },
};


let _lang = (() => {
    try { return localStorage.getItem('sncf-lang') || null; } catch { return null; }
})() || (navigator.language.startsWith('fr') ? 'fr' : 'en');

export function getLang() { return _lang; }
export function setLang(l) {
    _lang = l;
    try { localStorage.setItem('sncf-lang', l); } catch { /* storage blocked */ }
    applyTranslations();
}

/** Translate a key; calls it if it is a function (parametric strings). */
export function t(key, ...args) {
    const val = STRINGS[_lang]?.[key] ?? STRINGS['en']?.[key] ?? key;
    return typeof val === 'function' ? val(...args) : val;
}

/**
 * Apply translations to every data-i18n* element within a given root.
 * Works on any DOM subtree — including freshly cloned template content.
 * Called by applyTranslations() for the live document and by each module
 * that clones a template (popup, tooltip, etc.).
 */
export function applyI18n(root) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const val = t(el.dataset.i18n);
        if (el.tagName === 'INPUT') el.placeholder = val;
        else {
            el.textContent = val;
            // Setting textContent on <title> already updates document.title in all
            // modern browsers, but this explicit assignment makes the intent clear.
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

// Record count — stored at module level; updated by app.js via setRecordCount()
// and re-rendered on every language switch inside applyTranslations().
let _recordCount = null;

export function setRecordCount(data) {
    _recordCount = data;
}

/**
 * Apply translations to the full live document.
 * Also notifies registered listeners (filter panel, etc.).
 */
export function applyTranslations() {
    applyI18n(document.documentElement);
    document.documentElement.lang = _lang;
    document.querySelectorAll('.lang-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === _lang);
    });
    if (_recordCount) {
        const { totalSignals, tileCount } = _recordCount;
        const el = document.getElementById('record-count');
        if (el) el.textContent =
            `${totalSignals.toLocaleString()} ${t('status.signals_lower')} — ${tileCount} ${t('status.tiles_lower')}`;
    }
    _langListeners.forEach(fn => fn());
}

const _langListeners = [];
export function onLangChange(fn) { _langListeners.push(fn); }

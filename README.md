# SNCF – Permanent Signalling

Map viewer for SNCF permanent signalling data (RFN — Réseau Ferré National).  
Uses the **Jawg Transport** basemap, identical to data.sncf.com. No framework, no bundler.

---

## Quick start with Visual Studio 2022

### 1. Extract and open the project

Extract `sncf-sigmap.zip` to the folder of your choice  
(e.g. `C:\Users\You\source\repos\sncf-sigmap`), then:

*File → Open → Folder…* → select the `sncf-sigmap` folder.

### 2. Initialise the Git repository

*Git → Create Git Repository…*

VS 2022 lets you initialise the local repo **and** publish it to GitHub in one step.  
Choose a name, set visibility (public/private), and click **Create and Push**.  
The `.gitignore` included in the project is detected automatically.

### 3. Run a local development server

ES modules do **not** work over `file://` — a local HTTP server is required.

**Option A — Live Preview extension** *(recommended)*  
Install **Live Preview** (by Microsoft) from *Extensions → Manage Extensions*.  
Right-click `index.html` → *Show in Live Preview*. Auto-refreshes on save.

**Option B — IIS Express**  
Right-click `index.html` → *Open With → IIS Express*.

**Option C — Python (terminal)**
```bash
python -m http.server 8080
# then open http://localhost:8080
```

---

## Configuration

### Jawg Maps API key

The **jawg-transports** basemap requires a free API key (75,000 tiles/month, no credit card).

1. Create an account at [jawg.io](https://www.jawg.io/)
2. Copy your **Access Token** from the Jawg Lab dashboard
3. Open `js/config.js` and replace:

```js
export const JAWG_API_KEY = 'YOUR_JAWG_ACCESS_TOKEN';
```

Without a key, the app silently falls back to OSM Standard.

### GeoJSON data

Place the data file in `data/`:

```
data/signalisation-permanente.geojson    (~50–80 MB)
```

On startup the app fetches it automatically from `./data/`.  
If absent, a manual load button is available in the sidebar.  
**Data is cached in IndexedDB** after the first load — subsequent visits are instant.

---

## Large files on GitHub (> 100 MB)

GitHub rejects files larger than 100 MB. Two options:

### Git LFS *(recommended)*

```bash
# Install Git LFS from https://git-lfs.com/
git lfs install
git lfs track "data/*.geojson"
git add .gitattributes
git add data/signalisation-permanente.geojson
git commit -m "Add signals data via Git LFS"
git push
```

Netlify supports Git LFS natively — no extra configuration needed.

### External CDN

Host the file on Cloudflare R2, AWS S3, etc. and update `js/config.js`:

```js
export const DATA_URLS = {
  signals: 'https://your-cdn.example.com/signalisation-permanente.geojson',
};
```

---

## Netlify deployment

1. Push to GitHub
2. [app.netlify.com](https://app.netlify.com) → *Add new site → Import an existing project*
3. Select the GitHub repository
4. **Build command**: *(leave empty)*
5. **Publish directory**: `.`
6. Deploy — `netlify.toml` configures HTTP caching automatically.

---

## Project structure

```
sncf-sigmap/
├── index.html
├── favicon.svg / .png
├── robots.txt
├── netlify.toml
├── .gitignore
├── css/style.css
└── js/
│   ├── config.js           ← ⚠️  Set your Jawg key and data path here
│   ├── app.js              ← Main orchestration
│   ├── map.js              ← Leaflet, basemaps, geolocation
│   ├── filters.js          ← Dynamic filter panel
│   ├── popup.js            ← Signal popup with ‹ › navigation
│   ├── storage.js          ← IndexedDB cache
│   └── geojson.worker.js   ← Off-thread GeoJSON parsing (prevents UI freeze)
└── data/
    └── signalisation-permanente.geojson
```

## Technical notes

| Point | Detail |
|-------|--------|
| Web Worker | Parses GeoJSON off the main thread — prevents "page not responding" |
| IndexedDB | Persistent storage with no size limit (localStorage capped at 5 MB) |
| `preferCanvas: true` | Leaflet Canvas renderer — essential for 100,000+ markers |
| Native ES Modules | No bundler (Webpack/Vite) required |
| `maxZoom: 22` | Jawg tiles support zoom level 22 |

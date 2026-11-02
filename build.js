// Genera tracks.json scansionando la cartella audio/ alla ricerca di file audio.
// Ogni sottocartella diretta di audio/ diventa una categoria: i file al suo interno
// vengono etichettati con il nome della cartella. I file posti direttamente dentro
// audio/ (senza sottocartella) finiscono nella categoria di default.
// Viene eseguito automaticamente da Vercel prima del deploy.
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const AUDIO_DIR         = 'audio';
const AUDIO_EXT         = /\.(wav|mp3|ogg|flac|aac|m4a)$/i;
const DEFAULT_CATEGORY  = 'Generali';

function toTrack(dirPath, fileName, category) {
  const ext = path.extname(fileName);
  return {
    name:     path.basename(fileName, ext),
    file:     `${dirPath}/${fileName}`,
    badge:    ext.slice(1).toUpperCase(),
    category
  };
}

function audioFilesIn(dirPath) {
  return fs.readdirSync(dirPath).filter(f => AUDIO_EXT.test(f));
}

function collectTracks() {
  if (!fs.existsSync(AUDIO_DIR)) return [];

  const tracks = [];
  for (const entry of fs.readdirSync(AUDIO_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const dirPath = `${AUDIO_DIR}/${entry.name}`;
      audioFilesIn(dirPath).forEach(f => tracks.push(toTrack(dirPath, f, entry.name)));
      continue;
    }
    if (entry.isFile() && AUDIO_EXT.test(entry.name)) {
      tracks.push(toTrack(AUDIO_DIR, entry.name, DEFAULT_CATEGORY));
    }
  }
  return tracks;
}

function sortTracks(tracks) {
  return tracks.sort((a, b) =>
    a.category.localeCompare(b.category, 'it') || a.name.localeCompare(b.name, 'it')
  );
}

function writeTracks() {
  const tracks = sortTracks(collectTracks());
  fs.writeFileSync('tracks.json', JSON.stringify(tracks, null, 2), 'utf8');

  console.log(`tracks.json generato: ${tracks.length} traccia/e`);
  let lastCategory = null;
  for (const t of tracks) {
    if (t.category !== lastCategory) {
      console.log(`\n[${t.category}]`);
      lastCategory = t.category;
    }
    console.log(`  - ${t.name}`);
  }
}

// ── Service worker ──────────────────────────────────────────────────────────
// sw.js viene generato da sw.template.js stampando una versione calcolata sul contenuto dell'app shell:
// il browser rileva un nuovo service worker solo quando la shell cambia davvero (non quando si aggiungono audio).
const SHELL_FILES = [
  { url: '/',                              file: 'index.html' },
  { url: '/pwa.js',                        file: 'pwa.js' },
  { url: '/manifest.webmanifest',          file: 'manifest.webmanifest' },
  { url: '/tracks.json',                   file: null },
  { url: '/icons/icon-192.png',            file: 'icons/icon-192.png' },
  { url: '/icons/icon-512.png',            file: 'icons/icon-512.png' },
  { url: '/icons/icon-maskable-512.png',   file: 'icons/icon-maskable-512.png' },
  { url: '/icons/apple-touch-icon.png',    file: 'icons/apple-touch-icon.png' },
  { url: '/icons/favicon-32.png',          file: 'icons/favicon-32.png' },
  { url: '/icons/favicon.svg',             file: 'icons/favicon.svg' }
];

function shellVersion() {
  const hash = crypto.createHash('sha1');
  for (const f of SHELL_FILES) {
    if (f.file) hash.update(f.url).update(fs.readFileSync(f.file));
  }
  return hash.digest('hex').slice(0, 12);
}

function writeServiceWorker() {
  const version  = shellVersion();
  const template = fs.readFileSync('sw.template.js', 'utf8');
  if (!template.includes('__BUILD_VERSION__') || !template.includes('__SHELL_URLS__')) {
    throw new Error('sw.template.js: segnaposto mancanti');
  }
  const swSource = template
    .replace('__BUILD_VERSION__', version)
    .replace('__SHELL_URLS__', JSON.stringify(SHELL_FILES.map(f => f.url), null, 2));
  fs.writeFileSync('sw.js', swSource, 'utf8');
  console.log(`\nsw.js generato: versione ${version}`);
}

try {
  writeTracks();
  writeServiceWorker();
} catch (e) {
  console.error('Build fallita:', e.message);
  process.exit(1);
}

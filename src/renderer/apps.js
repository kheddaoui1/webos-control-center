/* App artwork + catalog for the Apps tab. Brand tiles are drawn inline so
   they look identical on every TV, even when the TV doesn't expose icon files. */

const BRAND_ART = {
  netflix: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#0a0a0a"/><path fill="#E50914" d="M12 5h8l8 25V5h8v38h-8L20 18v25h-8z"/></svg>`,

  youtube: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#FF0000"/><path fill="#fff" d="M20 15.5l14 8.5-14 8.5z"/></svg>`,

  prime: `<svg viewBox="0 0 48 48"><defs><linearGradient id="pv1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1c3358"/><stop offset="1" stop-color="#080f1d"/></linearGradient></defs><rect width="48" height="48" fill="url(#pv1)"/><text x="24" y="23" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="12.5" font-weight="700" fill="#fff">prime</text><path d="M13 28.5c6 4.4 16 4.4 22-.6" stroke="#00A8E1" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M33 26.5l3.3 1.1-1.1 3.2" fill="#00A8E1"/></svg>`,

  disney: `<svg viewBox="0 0 48 48"><defs><linearGradient id="dsp1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1b3fd8"/><stop offset="1" stop-color="#081a6b"/></linearGradient></defs><rect width="48" height="48" fill="url(#dsp1)"/><text x="24" y="32" text-anchor="middle" font-family="Georgia, serif" font-size="23" font-weight="700" fill="#ffffff">D+</text></svg>`,

  max: `<svg viewBox="0 0 48 48"><defs><linearGradient id="mx1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4432c9"/><stop offset="1" stop-color="#0b1a67"/></linearGradient></defs><rect width="48" height="48" fill="url(#mx1)"/><text x="24" y="29" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="750" fill="#fff">max</text></svg>`,

  appletv: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#0d0d0f"/><path fill="#f2f2f4" d="M25.7 14.4c1-1.2 1.7-2.9 1.5-4.6-1.5.1-3.3 1-4.4 2.2-1 1.1-1.8 2.9-1.6 4.5 1.7.1 3.4-.9 4.5-2.1zm4.2 8.6c-2.4-.1-4.5 1.4-5.7 1.4-1.2 0-3-1.3-4.9-1.3-2.5 0-4.8 1.5-6.1 3.8-2.6 4.5-.7 11.1 1.9 14.8 1.2 1.8 2.7 3.8 4.7 3.7 1.9-.1 2.6-1.2 4.9-1.2s2.9 1.2 4.9 1.2c2 0 3.3-1.8 4.5-3.6 1.4-2.1 2-4.2 2-4.3-.1 0-3.9-1.5-3.9-5.9 0-3.6 2.9-5.4 3.1-5.5-1.9-2.8-4.8-3.2-5.4-3.2z"/><text x="24" y="45.5" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="7" font-weight="650" fill="#b9bcc6">TV</text></svg>`,

  spotify: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#0d0d0d"/><circle cx="24" cy="24" r="14.5" fill="#1DB954"/><path d="M16 20.3c5.2-1.5 11.3-1 15.6 1.5M17 25c4.1-1.1 9.2-.7 12.8 1.2M18 29.4c3.1-.7 6.8-.4 9.4 1" stroke="#0d0d0d" stroke-width="2.7" fill="none" stroke-linecap="round"/></svg>`,

  plex: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#111"/><path fill="#E5A00D" d="M20.5 7h9.6L19.4 24l10.7 17h-9.6L9.8 24z"/></svg>`,

  twitch: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#9146FF"/><path fill="#fff" d="M13.5 9h22v16.4l-6.4 6.4h-6.7l-5.4 5.3v-5.3h-3.5z"/><path d="M22 14.5v7M28.5 14.5v7" stroke="#9146FF" stroke-width="2.6" stroke-linecap="round"/></svg>`,

  hulu: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#0a0f0d"/><text x="24" y="29.5" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="800" fill="#1CE783">hulu</text></svg>`,

  crunchyroll: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#F47521"/><circle cx="24" cy="24" r="11.5" fill="none" stroke="#fff" stroke-width="3"/><path d="M20 16.5c6.5 2 9.5 5.6 8.6 12" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="24" cy="24" r="3.4" fill="#fff"/></svg>`,

  paramount: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#0064FF"/><path fill="#fff" d="M8 33l8.6-15.5 5.3 9.4 4.2-7.4L34 33z"/><text x="24" y="41.5" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="7.5" font-weight="700" fill="#fff">P+</text></svg>`,

  peacock: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#0b0b0d"/><g transform="translate(24 24)"><path fill="#F5C518" d="M0-13L4-4 13-2 6 4 8 13 0 8-8 13-6 4-13-2-4-4z" opacity=".95"/><path fill="#FF4B44" d="M0-13L1.6-4 8 3 0 1-8 3-1.6-4z" opacity=".5"/></g></svg>`,

  browser: `<svg viewBox="0 0 48 48"><defs><linearGradient id="br1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#3E8BFF"/><stop offset="1" stop-color="#6C4BFF"/></linearGradient></defs><rect width="48" height="48" fill="url(#br1)"/><circle cx="24" cy="24" r="13" fill="none" stroke="#fff" stroke-width="2"/><ellipse cx="24" cy="24" rx="6" ry="13" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M11.5 21h25M11.5 27h25" stroke="#fff" stroke-width="1.7"/></svg>`,

  livetv: `<svg viewBox="0 0 48 48"><defs><linearGradient id="lt1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2b2438"/><stop offset="1" stop-color="#121018"/></linearGradient></defs><rect width="48" height="48" fill="url(#lt1)"/><rect x="10" y="16" width="28" height="19" rx="3.5" fill="none" stroke="#ff8fa6" stroke-width="2"/><path d="M18 10l6 5 6-5" stroke="#ff6f8e" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path fill="#ff5578" d="M22 21.5l8 4-8 4z"/></svg>`,

  settings: `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#24222b"/><circle cx="24" cy="24" r="5.2" fill="none" stroke="#d7d2e2" stroke-width="2.4"/><path d="M24 10.5v3.2M24 34.3v3.2M10.5 24h3.2M34.3 24h3.2M14.5 14.5l2.3 2.3M31.2 31.2l2.3 2.3M33.5 14.5l-2.3 2.3M16.8 31.2l-2.3 2.3" stroke="#d7d2e2" stroke-width="2.4" stroke-linecap="round"/></svg>`,

  music: `<svg viewBox="0 0 48 48"><defs><linearGradient id="mu1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff2e63"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs><rect width="48" height="48" fill="url(#mu1)"/><path d="M28 11v19.5M28 11l9-2v6l-9 2" stroke="#fff" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="23.5" cy="31.5" rx="5" ry="3.8" fill="#fff"/></svg>`,

  photos: `<svg viewBox="0 0 48 48"><defs><linearGradient id="ph1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#12b8a6"/><stop offset="1" stop-color="#1d5bd8"/></linearGradient></defs><rect width="48" height="48" fill="url(#ph1)"/><rect x="9" y="12" width="30" height="24" rx="3" fill="none" stroke="#fff" stroke-width="2"/><circle cx="18" cy="20" r="2.6" fill="#fff"/><path d="M10 32l8-8 6 5 5-4 9 7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  games: `<svg viewBox="0 0 48 48"><defs><linearGradient id="gm1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7a5cff"/><stop offset="1" stop-color="#c23bff"/></linearGradient></defs><rect width="48" height="48" fill="url(#gm1)"/><path d="M16 18h16a7 7 0 0 1 6.8 8.5l-1.3 7a4.3 4.3 0 0 1-7.2 2.2l-3.3-3.2h-6l-3.3 3.2a4.3 4.3 0 0 1-7.2-2.2l-1.3-7A7 7 0 0 1 16 18z" fill="none" stroke="#fff" stroke-width="2"/><path d="M17 26h6M20 23v6" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="30" cy="25" r="1.5" fill="#fff"/><circle cx="33.5" cy="28.5" r="1.5" fill="#fff"/></svg>`,

  hdmi: `<svg viewBox="0 0 24 24"><path d="M5 8h14v6l-2 3H7l-2-3z"/><path d="M9 8V6h6v2" opacity=".6"/></svg>`
};

const APP_BRANDS = [
  { key: 'netflix', test: /netflix/i, name: 'Netflix' },
  { key: 'youtube', test: /youtube(?!kids)/i, name: 'YouTube' },
  { key: 'prime', test: /amazon(?!.*alexa)|prime ?video|primevideo/i, name: 'Prime Video' },
  { key: 'disney', test: /disney/i, name: 'Disney+' },
  { key: 'max', test: /hbomax|hbo ?max|wbd|^max$|\.max$/i, name: 'Max' },
  { key: 'appletv', test: /appletv|apple\.tv|apple ?tv/i, name: 'Apple TV' },
  { key: 'spotify', test: /spotify/i, name: 'Spotify' },
  { key: 'plex', test: /plex|cdp-30/i, name: 'Plex' },
  { key: 'twitch', test: /twitch/i, name: 'Twitch' },
  { key: 'hulu', test: /hulu/i, name: 'Hulu' },
  { key: 'crunchyroll', test: /crunchyroll/i, name: 'Crunchyroll' },
  { key: 'paramount', test: /paramount/i, name: 'Paramount+' },
  { key: 'peacock', test: /peacock/i, name: 'Peacock' },
  { key: 'browser', test: /browser|internet/i, name: 'Web Browser' },
  { key: 'livetv', test: /livetv|live ?tv|com\.webos\.app\.livetv/i, name: 'Live TV' },
  { key: 'settings', test: /settings|palm\.app\.settings/i, name: 'Settings' },
  { key: 'music', test: /music|audio/i, name: 'Music' },
  { key: 'photos', test: /photo|gallery/i, name: 'Photos' },
  { key: 'games', test: /game|stadia|luna/i, name: 'Games' }
];

const APP_CATALOG = [
  { id: 'netflix', title: 'Netflix' },
  { id: 'youtube.leanback.v4', title: 'YouTube' },
  { id: 'amazon', title: 'Prime Video' },
  { id: 'com.disney.disneyplus-prod', title: 'Disney+' },
  { id: 'com.hbo.hbomax', title: 'Max' },
  { id: 'com.apple.appletv', title: 'Apple TV' },
  { id: 'spotify-beehive', title: 'Spotify' },
  { id: 'cdp-30', title: 'Plex' },
  { id: 'tv.twitch.tv.starshot.lg', title: 'Twitch' },
  { id: 'hulu', title: 'Hulu' },
  { id: 'com.crunchyroll.webapp', title: 'Crunchyroll' },
  { id: 'com.peacock.tv', title: 'Peacock' },
  { id: 'com.webos.app.browser', title: 'Web Browser' },
  { id: 'com.webos.app.livetv', title: 'Live TV' },
  { id: 'com.webos.app.music', title: 'Music' },
  { id: 'com.webos.app.photovideo', title: 'Photos' },
  { id: 'com.palm.app.settings', title: 'Settings' }
];

const HIDDEN_APPS = /^com\.webos\.app\.(home|launcher|homeconnect|inputpicker|discovery|mediaplayer)$/;

const APP_PRIORITY = [
  'netflix', 'youtube', 'prime', 'disney', 'max', 'appletv', 'spotify', 'plex',
  'twitch', 'hulu', 'crunchyroll', 'paramount', 'peacock', 'browser', 'livetv', 'music', 'photos', 'games'
];

function brandFor(id, title) {
  const haystack = `${id} ${title || ''}`;
  return APP_BRANDS.find((brand) => brand.test.test(haystack)) || null;
}

function hashHue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

function initialsFor(title, id) {
  const source = (title || id || '?').replace(/^(com|tv|app|webos)[.\s]/i, '');
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function appVisual(app) {
  const brand = brandFor(app.id, app.title);
  const title = brand ? brand.name : (app.title || app.id);
  if (app.icon) {
    return { title, html: `<img src="${app.icon}" alt="" loading="lazy" draggable="false">`, hue: null };
  }
  if (brand && BRAND_ART[brand.key]) {
    return { title, html: BRAND_ART[brand.key], hue: null };
  }
  const hue = hashHue(app.id || title);
  return {
    title,
    html: `<span class="app-initials">${initialsFor(title, app.id)}</span>`,
    hue,
    background: `linear-gradient(145deg, hsl(${hue} 55% 40%), hsl(${(hue + 46) % 360} 58% 23%))`
  };
}

function appPriority(app) {
  const brand = brandFor(app.id, app.title);
  if (!brand) return 100;
  const index = APP_PRIORITY.indexOf(brand.key);
  return index === -1 ? 99 : index;
}

function sortApps(apps) {
  return apps.slice().sort((a, b) => {
    const pa = appPriority(a);
    const pb = appPriority(b);
    if (pa !== pb) return pa - pb;
    return (a.title || a.id).localeCompare(b.title || b.id);
  });
}

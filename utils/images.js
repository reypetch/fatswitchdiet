const https = require('https');

const FALLBACK = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80';

function getUnsplashImage(query) {
  return new Promise((resolve) => {
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return resolve(FALLBACK);

    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const req = https.get(url, { headers: { Authorization: `Client-ID ${key}` } }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const img = data.results?.[0]?.urls?.regular;
          resolve(img || FALLBACK);
        } catch {
          resolve(FALLBACK);
        }
      });
    });
    req.on('error', () => resolve(FALLBACK));
  });
}

module.exports = { getUnsplashImage };

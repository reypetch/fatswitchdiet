const https = require('https');

const FALLBACK = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80';

const NOISE_WORDS = new Set([
  'fat-burning', 'fat', 'burning', 'metabolism', 'metabolic', 'protein',
  'lightened', 'light', 'healthy', 'guilt-free', 'switch', 'diet',
  'low-carb', 'high-protein', 'crispy', 'boosting', 'boosted',
  'packed', 'powered', 'loaded', 'style', 'inspired', 'homemade',
  'easy', 'quick', 'simple', 'classic', 'hearty', 'delicious',
  'fresh', 'zesty', 'creamy', 'fluffy', 'smoked', 'roasted',
  'grilled', 'baked', 'pan', 'seared',
]);

function cleanQuery(title) {
  const words = title
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE_WORDS.has(w));
  return words.slice(0, 3).join(' ');
}

function getUnsplashImage(query) {
  const cleaned = cleanQuery(query);
  return new Promise((resolve) => {
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return resolve(FALLBACK);

    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(cleaned)}&per_page=1&orientation=landscape`;
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

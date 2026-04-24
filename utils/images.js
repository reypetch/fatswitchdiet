const https = require('https');

const FALLBACK = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80';

// Individual words only — hyphens are split before this set is checked
const NOISE_WORDS = new Set([
  // diet / marketing
  'fat', 'burning', 'metabolism', 'metabolic', 'switch', 'diet',
  'guilt', 'free', 'healthy', 'light', 'lightened', 'boost', 'boosting', 'boosted',
  'low', 'carb', 'high', 'protein', 'packed', 'powered', 'loaded',
  // cooking style
  'crispy', 'creamy', 'fluffy', 'smoked', 'roasted', 'grilled', 'baked', 'pan', 'seared',
  // filler adjectives
  'easy', 'quick', 'simple', 'classic', 'hearty', 'delicious', 'fresh',
  'zesty', 'homemade', 'inspired', 'style', 'truffle',
  // stop words
  'with', 'the', 'and', 'or', 'in', 'of', 'for', 'on', 'my',
]);

// Exact dish overrides — checked before noise filtering for reliable image results
const DISH_OVERRIDES = [
  [/nasi\s+goreng/i,    'nasi goreng indonesian'],
  [/mandi\s+rice/i,     'mandi rice arabic'],
  [/smash\s+burger/i,   'smash burger'],
  [/pad\s+thai/i,       'pad thai noodles'],
  [/tom\s+yum/i,        'tom yum soup'],
  [/poke\s+bowl/i,      'poke bowl'],
  [/banh\s+mi/i,        'banh mi sandwich'],
  [/bibim\s*bap/i,      'bibimbap korean'],
  [/pho\b/i,            'pho vietnamese noodles'],
  [/rendang/i,          'beef rendang indonesian'],
  [/bulgogi/i,          'bulgogi korean beef'],
  [/gyudon/i,           'gyudon japanese beef rice'],
  [/teriyaki/i,         'teriyaki japanese'],
  [/laksa/i,            'laksa noodle soup'],
  [/char\s+kway\s+teow/i, 'char kway teow noodles'],
];

function cleanQuery(title) {
  for (const [pattern, query] of DISH_OVERRIDES) {
    if (pattern.test(title)) return query;
  }

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

module.exports = { getUnsplashImage, cleanQuery };

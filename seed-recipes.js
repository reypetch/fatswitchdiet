require('dotenv').config();
const http = require('http');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

const recipes = [
  // Dinner (8)
  { prompt: 'teriyaki salmon bowl',             category: 'Dinner',    servings: 2 },
  { prompt: 'creamy chicken alfredo',            category: 'Dinner',    servings: 4 },
  { prompt: 'korean beef bulgogi',               category: 'Dinner',    servings: 4 },
  { prompt: 'thai green curry chicken',          category: 'Dinner',    servings: 4 },
  { prompt: 'garlic butter shrimp pasta',        category: 'Dinner',    servings: 2 },
  { prompt: 'mexican chicken burrito bowl',      category: 'Dinner',    servings: 4 },
  { prompt: 'japanese gyudon beef rice',         category: 'Dinner',    servings: 2 },
  { prompt: 'honey garlic pork tenderloin',      category: 'Dinner',    servings: 4 },
  // Breakfast (6)
  { prompt: 'fluffy japanese pancakes',          category: 'Breakfast', servings: 2 },
  { prompt: 'avocado egg toast',                 category: 'Breakfast', servings: 1 },
  { prompt: 'greek yogurt parfait',              category: 'Breakfast', servings: 1 },
  { prompt: 'banana oat smoothie bowl',          category: 'Breakfast', servings: 1 },
  { prompt: 'scrambled eggs with smoked salmon', category: 'Breakfast', servings: 2 },
  { prompt: 'overnight oats',                    category: 'Breakfast', servings: 1 },
  // Lunch (5)
  { prompt: 'vietnamese chicken pho',            category: 'Lunch',     servings: 2 },
  { prompt: 'mediterranean quinoa salad',        category: 'Lunch',     servings: 2 },
  { prompt: 'chicken caesar wrap',               category: 'Lunch',     servings: 1 },
  { prompt: 'tom yum soup',                      category: 'Lunch',     servings: 2 },
  { prompt: 'spicy tuna poke bowl',              category: 'Lunch',     servings: 1 },
  // Dessert (3)
  { prompt: 'chocolate lava cake',               category: 'Desserts',  servings: 2 },
  { prompt: 'mango sticky rice',                 category: 'Desserts',  servings: 2 },
  { prompt: 'tiramisu lightened',                category: 'Desserts',  servings: 6 },
  // Snack (3)
  { prompt: 'protein energy balls',              category: 'Snacks',    servings: 12 },
  { prompt: 'baked sweet potato chips',          category: 'Snacks',    servings: 2 },
  { prompt: 'almond butter apple slices',        category: 'Snacks',    servings: 1 },
];

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: PORT,
      path: '/api/generate-recipe', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const skipArg = process.argv.find((a) => a.startsWith('--skip='));
  const skip = skipArg ? parseInt(skipArg.split('=')[1], 10) : 0;

  // Verify server is up
  try {
    await post({ prompt: 'test' });
  } catch (e) {
    if (e.code === 'ECONNREFUSED') {
      console.error('Server is not running. Start it with: npm run dev');
      process.exit(1);
    }
  }

  const batch = recipes.slice(skip);
  console.log(`Seeding ${batch.length} recipes (skipping first ${skip}) via HTTP API (port ${PORT})...\n`);
  let ok = 0, fail = 0;

  for (let i = 0; i < batch.length; i++) {
    const globalIndex = skip + i;
    const { prompt, category, servings } = batch[i];
    process.stdout.write(`[${globalIndex + 1}/${recipes.length}] ${prompt} (${category})... `);
    try {
      const res = await post({ prompt, category, servings });
      if (res.status === 200 && res.body.success) {
        console.log(`✓  "${res.body.recipe.title}"`);
        ok++;
      } else {
        console.log(`✗  ${res.body.error || JSON.stringify(res.body)}`);
        fail++;
      }
    } catch (err) {
      console.log(`✗  ${err.message}`);
      fail++;
    }

    if (i < batch.length - 1) await sleep(3000);
  }

  console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);
  if (skip + ok < recipes.length) {
    console.log(`Resume with: node seed-recipes.js --skip=${skip + ok}`);
  }
}

main();

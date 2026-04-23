require('dotenv').config();
const fs = require('fs');

// Clear stale lock
const dbPath = process.env.DB_PATH || './db/recipes.db';
const lockDir = dbPath + '.lock';
if (fs.existsSync(lockDir)) fs.rmSync(lockDir, { recursive: true, force: true });

const db = require('./db/database');
const { getUnsplashImage } = require('./utils/images');

// Ensure column exists
try { db.run('ALTER TABLE recipes ADD COLUMN image_url TEXT'); } catch (_) {}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const recipes = db.prepare('SELECT id, title FROM recipes ORDER BY id').all();
  console.log(`Re-fetching images for ${recipes.length} recipes with cleaned queries...\n`);

  let ok = 0, fail = 0;
  for (let i = 0; i < recipes.length; i++) {
    const { id, title } = recipes[i];
    process.stdout.write(`[${i + 1}/${recipes.length}] ${title}... `);
    try {
      const url = await getUnsplashImage(title);
      db.prepare('UPDATE recipes SET image_url = ? WHERE id = ?').run([url, id]);
      console.log('✓');
      ok++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      fail++;
    }
    if (i < recipes.length - 1) await sleep(500);
  }

  console.log(`\nDone. ${ok} updated, ${fail} failed.`);
  process.exit(0);
}

main();

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
  const recipes = db
    .prepare("SELECT id, title FROM recipes WHERE image_url IS NULL OR image_url = '' ORDER BY id")
    .all();

  if (recipes.length === 0) {
    console.log('All recipes already have images. Nothing to do.');
    process.exit(0);
  }

  console.log(`Fetching images for ${recipes.length} recipes missing image_url...\n`);

  let ok = 0, fail = 0;
  for (let i = 0; i < recipes.length; i++) {
    const { id, title } = recipes[i];
    process.stdout.write(`[${i + 1}/${recipes.length}] ${title}... `);
    try {
      const url = await getUnsplashImage(title);
      db.prepare('UPDATE recipes SET image_url = ? WHERE id = ?').run([url, id]);
      console.log(`✓  ${url.slice(0, 60)}...`);
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

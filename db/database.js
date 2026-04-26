const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const dbBase = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DB_PATH || './data';
const dbPath = dbBase.endsWith('.db') ? dbBase : path.join(dbBase, 'recipes.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// Clear stale lock artifacts left by crashed processes
const lockDir = dbPath + '.lock';
const walFile = dbPath + '-wal';
const shmFile = dbPath + '-shm';
if (fs.existsSync(lockDir)) { fs.rmSync(lockDir, { recursive: true, force: true }); console.log('[db] cleared stale .lock dir'); }
if (fs.existsSync(walFile)) { fs.rmSync(walFile, { force: true }); console.log('[db] cleared stale -wal file'); }
if (fs.existsSync(shmFile)) { fs.rmSync(shmFile, { force: true }); console.log('[db] cleared stale -shm file'); }

const db = new Database(dbPath);

db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA busy_timeout = 5000');
db.run('PRAGMA foreign_keys = ON');

db.run(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT DEFAULT '🍽️'
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    ingredients TEXT NOT NULL,
    instructions TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    image_url TEXT,
    prep_time INTEGER,
    cook_time INTEGER,
    servings INTEGER DEFAULT 4,
    calories INTEGER,
    protein REAL,
    carbs REAL,
    fat REAL,
    fiber REAL,
    tags TEXT,
    ai_generated INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS diet_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    duration_days INTEGER DEFAULT 7,
    calories_per_day INTEGER,
    goal TEXT,
    meal_plan TEXT,
    ai_generated INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Seed categories
const seedCat = db.prepare(`INSERT OR IGNORE INTO categories (name, slug, description, icon) VALUES (?, ?, ?, ?)`);
const categories = [
  ['Breakfast', 'breakfast', 'Start your day right with fat-switching breakfast ideas', '🌅'],
  ['Lunch', 'lunch', 'Satisfying midday meals to keep you energized', '🥗'],
  ['Dinner', 'dinner', 'Wholesome evening meals for the whole family', '🍽️'],
  ['Snacks', 'snacks', 'Smart snacking to keep hunger at bay', '🥜'],
  ['Smoothies', 'smoothies', 'Nutrient-packed blends for any time of day', '🥤'],
  ['Desserts', 'desserts', 'Guilt-free sweets that satisfy cravings', '🍓'],
  ['High Protein', 'high-protein', 'Muscle-building recipes with maximum protein', '💪'],
  ['Low Carb', 'low-carb', 'Carb-conscious meals for metabolic health', '🥦'],
];
db.run('BEGIN');
try {
  categories.forEach(([name, slug, desc, icon]) => seedCat.run([name, slug, desc, icon]));
  db.run('COMMIT');
} catch (e) {
  db.run('ROLLBACK');
  throw e;
}


// Safe migration: add data column for rich JSON recipe format
try { db.run('ALTER TABLE recipes ADD COLUMN data TEXT'); } catch (_) {}
try { db.run('ALTER TABLE recipes ADD COLUMN cuisine TEXT'); } catch (_) {}
try { db.run('ALTER TABLE recipes ADD COLUMN keyword TEXT'); } catch (_) {}
try { db.run('ALTER TABLE recipes ADD COLUMN image_url TEXT'); } catch (_) {}

// ── Exported helper methods ───────────────────────────────────

function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY name').all();
}

function getRecentRecipes(limit = 12) {
  return db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    ORDER BY r.created_at DESC LIMIT ?
  `).all(limit);
}

function getFeaturedRecipes(limit = 6) {
  return db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    WHERE r.featured = 1 ORDER BY r.created_at DESC LIMIT ?
  `).all(limit);
}

function getTotalCount() {
  return db.prepare('SELECT COUNT(*) as n FROM recipes').get().n;
}

function getRecipe(slug) {
  const row = db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    WHERE r.slug = ?
  `).get([slug]);
  if (!row) return null;
  // Parse JSON columns
  if (typeof row.data === 'string')         { try { row.data         = JSON.parse(row.data);         } catch (_) {} }
  if (typeof row.ingredients === 'string')  { try { row.ingredients  = JSON.parse(row.ingredients);  } catch (_) {} }
  if (typeof row.instructions === 'string') { try { row.instructions = JSON.parse(row.instructions); } catch (_) {} }
  if (typeof row.tags === 'string')         { try { row.tags         = JSON.parse(row.tags);         } catch (_) {} }
  return row;
}

function getByCategory(catName) {
  return db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    WHERE c.name LIKE ?
    ORDER BY r.created_at DESC
  `).all([`%${catName}%`]);
}

function saveRecipe({ slug, title, category, cuisine, keyword, data }) {
  const catRow = db.prepare('SELECT id FROM categories WHERE name LIKE ?').get([`%${category}%`]);
  const desc = data.description || '';
  db.prepare(`
    INSERT OR REPLACE INTO recipes
      (title, slug, description, ingredients, instructions, category_id, prep_time, cook_time,
       servings, calories, protein, carbs, fat, tags, ai_generated, cuisine, keyword, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run([
    title, slug, desc,
    JSON.stringify(data.ingredients || []),
    JSON.stringify(data.instructions || []),
    catRow?.id || null,
    data.prep_time  || null,
    data.cook_time  || null,
    data.servings   || 4,
    data.nutrition?.switched?.calories || null,
    data.nutrition?.switched?.protein  || null,
    data.nutrition?.switched?.carbs    || null,
    data.nutrition?.switched?.fat      || null,
    JSON.stringify(data.related_keywords || []),
    cuisine || null,
    keyword || null,
    JSON.stringify(data),
  ]);
}

function searchRecipes(q) {
  const like = `%${q}%`;
  return db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    WHERE r.title LIKE ? OR r.description LIKE ?
    ORDER BY r.created_at DESC LIMIT 20
  `).all([like, like]);
}

function getAllRecipes() {
  return db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    ORDER BY r.created_at DESC
  `).all();
}

module.exports = {
  // Raw db for scripts that need direct access (backfill, admin routes, etc.)
  prepare: (sql) => db.prepare(sql),
  run:     (sql, params) => params ? db.prepare(sql).run(params) : db.run(sql),
  get:     (sql, params) => params ? db.prepare(sql).get(params) : db.get(sql),
  // Named methods for server.js
  getCategories,
  getRecentRecipes,
  getFeaturedRecipes,
  getTotalCount,
  getRecipe,
  getByCategory,
  saveRecipe,
  searchRecipes,
  getAllRecipes,
};

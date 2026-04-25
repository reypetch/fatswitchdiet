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

// Seed sample recipes
const recipeCount = db.get('SELECT COUNT(*) as count FROM recipes');
if (recipeCount.count === 0) {
  const ins = db.prepare(`
    INSERT INTO recipes (title, slug, description, ingredients, instructions, category_id, prep_time, cook_time, servings, calories, protein, carbs, fat, fiber, tags, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const catId = (slug) => db.get('SELECT id FROM categories WHERE slug = ?', [slug])?.id;

  db.run('BEGIN');
  try {
    ins.run([
      'Greek Yogurt Protein Bowl', 'greek-yogurt-protein-bowl',
      'A creamy, protein-rich breakfast bowl loaded with fresh berries and crunchy granola.',
      JSON.stringify(['2 cups Greek yogurt (0% fat)', '1/2 cup mixed berries', '1/4 cup granola', '1 tbsp honey', '1 tbsp chia seeds', '1/4 tsp vanilla extract']),
      JSON.stringify(['Add Greek yogurt to a bowl.', 'Top with mixed berries and granola.', 'Drizzle with honey.', 'Sprinkle chia seeds and serve immediately.']),
      catId('breakfast'), 5, 0, 2, 320, 28, 42, 4, 5, JSON.stringify(['protein', 'quick', 'no-cook']), 1
    ]);
    ins.run([
      'Avocado Chicken Salad', 'avocado-chicken-salad',
      'A fresh, satisfying salad with grilled chicken, creamy avocado, and a zesty lime dressing.',
      JSON.stringify(['300g grilled chicken breast, sliced', '1 ripe avocado, cubed', '2 cups mixed greens', '1/2 cup cherry tomatoes', '1/4 red onion, thinly sliced', '2 tbsp lime juice', '1 tbsp olive oil', 'Salt and pepper to taste']),
      JSON.stringify(['Combine greens, cherry tomatoes, and red onion in a large bowl.', 'Add sliced chicken and avocado.', 'Whisk lime juice and olive oil together for dressing.', 'Drizzle dressing over salad, season, and toss gently.']),
      catId('lunch'), 10, 0, 2, 420, 38, 12, 24, 8, JSON.stringify(['high-protein', 'gluten-free', 'keto']), 1
    ]);
    ins.run([
      'Salmon with Roasted Vegetables', 'salmon-roasted-vegetables',
      'Omega-3 rich salmon fillet paired with colorful roasted vegetables for a complete fat-switching dinner.',
      JSON.stringify(['2 salmon fillets (180g each)', '1 zucchini, sliced', '1 bell pepper, chunked', '200g broccoli florets', '2 tbsp olive oil', '3 cloves garlic, minced', '1 lemon, sliced', 'Fresh dill', 'Salt and pepper']),
      JSON.stringify(['Preheat oven to 200°C (400°F).', 'Toss vegetables with 1 tbsp olive oil, salt, and pepper. Spread on baking sheet.', 'Roast vegetables for 15 minutes.', 'Season salmon, place on baking sheet with vegetables and lemon slices.', 'Roast another 12-15 minutes until salmon flakes easily.', 'Garnish with fresh dill and serve.']),
      catId('dinner'), 10, 25, 2, 480, 42, 18, 24, 6, JSON.stringify(['omega-3', 'gluten-free', 'high-protein']), 1
    ]);
    ins.run([
      'Green Metabolism Smoothie', 'green-metabolism-smoothie',
      'A vibrant green smoothie packed with fat-burning ingredients to kickstart your metabolism.',
      JSON.stringify(['1 cup spinach', '1/2 frozen banana', '1/2 cup frozen mango', '1 tbsp ginger, grated', '1 tbsp flaxseed', '1 cup unsweetened almond milk', 'Juice of 1/2 lemon']),
      JSON.stringify(['Add almond milk to blender first.', 'Add spinach, banana, mango, ginger, and flaxseed.', 'Blend on high for 60 seconds until smooth.', 'Add lemon juice, blend briefly, and serve immediately.']),
      catId('smoothies'), 5, 0, 1, 210, 5, 38, 5, 6, JSON.stringify(['vegan', 'dairy-free', 'detox']), 1
    ]);
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
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

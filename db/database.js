const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const dbBase = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DB_PATH || './data';
const dbPath = dbBase.endsWith('.db') ? dbBase : path.join(dbBase, 'recipes.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

db.run('PRAGMA journal_mode = WAL');
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

module.exports = db;

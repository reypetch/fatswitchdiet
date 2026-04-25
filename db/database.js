const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure db directory exists (important on Render — use /tmp or persistent disk)
const DB_DIR = process.env.DB_PATH || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_FILE = path.join(DB_DIR, 'recipes.db');
const db = new Database(DB_FILE);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ── Schema ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT    UNIQUE NOT NULL,
    title       TEXT    NOT NULL,
    category    TEXT    DEFAULT 'Dinner',
    cuisine     TEXT    DEFAULT 'International',
    keyword     TEXT,
    data        TEXT    NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    views       INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_slug     ON recipes(slug);
  CREATE INDEX IF NOT EXISTS idx_category ON recipes(category);
  CREATE INDEX IF NOT EXISTS idx_created  ON recipes(created_at DESC);
`);

// ── Queries ──────────────────────────────────────────────────
const stmts = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO recipes (slug, title, category, cuisine, keyword, data)
    VALUES (@slug, @title, @category, @cuisine, @keyword, @data)
  `),

  getBySlug: db.prepare(`
    SELECT * FROM recipes WHERE slug = ?
  `),

  incrementViews: db.prepare(`
    UPDATE recipes SET views = views + 1 WHERE slug = ?
  `),

  getAll: db.prepare(`
    SELECT id, slug, title, category, cuisine, created_at, views,
           json_extract(data, '$.fat_switch.switched_kcal') AS kcal,
           json_extract(data, '$.fat_switch.savings_pct')   AS savings_pct,
           json_extract(data, '$.description')               AS description
    FROM recipes ORDER BY created_at DESC LIMIT 50
  `),

  getByCategory: db.prepare(`
    SELECT id, slug, title, category, cuisine, created_at, views,
           json_extract(data, '$.fat_switch.switched_kcal') AS kcal,
           json_extract(data, '$.fat_switch.savings_pct')   AS savings_pct,
           json_extract(data, '$.description')               AS description
    FROM recipes WHERE category = ? ORDER BY created_at DESC LIMIT 20
  `),

  getRecent: db.prepare(`
    SELECT id, slug, title, category, cuisine,
           json_extract(data, '$.fat_switch.switched_kcal') AS kcal,
           json_extract(data, '$.fat_switch.savings_pct')   AS savings_pct,
           json_extract(data, '$.description')               AS description
    FROM recipes ORDER BY created_at DESC LIMIT 6
  `),

  search: db.prepare(`
    SELECT id, slug, title, category, cuisine,
           json_extract(data, '$.fat_switch.switched_kcal') AS kcal,
           json_extract(data, '$.fat_switch.savings_pct')   AS savings_pct,
           json_extract(data, '$.description')               AS description
    FROM recipes
    WHERE title LIKE ? OR keyword LIKE ? OR cuisine LIKE ?
    ORDER BY views DESC LIMIT 20
  `),

  count: db.prepare(`SELECT COUNT(*) AS total FROM recipes`)
};

const CATEGORIES = [
  { name: 'Breakfast', slug: 'breakfast', icon: '🌅', description: 'Start your day right with fat-switching breakfast ideas' },
  { name: 'Lunch',     slug: 'lunch',     icon: '🥗', description: 'Satisfying midday meals to keep you energized' },
  { name: 'Dinner',    slug: 'dinner',    icon: '🍽️', description: 'Wholesome evening meals for the whole family' },
  { name: 'Snacks',    slug: 'snacks',    icon: '🥜', description: 'Smart snacking to keep hunger at bay' },
  { name: 'Desserts',  slug: 'desserts',  icon: '🍓', description: 'Guilt-free sweets that satisfy cravings' },
  { name: 'Smoothies', slug: 'smoothies', icon: '🥤', description: 'Nutrient-packed blends for any time of day' },
  { name: 'High Protein', slug: 'high-protein', icon: '💪', description: 'Muscle-building recipes with maximum protein' },
  { name: 'Low Carb',  slug: 'low-carb',  icon: '🥦', description: 'Carb-conscious meals for metabolic health' },
];

module.exports = {
  getCategories() {
    return CATEGORIES;
  },

  getFeaturedRecipes() {
    return stmts.getRecent.all();
  },

  saveRecipe({ slug, title, category, cuisine, keyword, data }) {
    stmts.insert.run({ slug, title, category, cuisine, keyword, data: JSON.stringify(data) });
  },

  getRecipe(slug) {
    const row = stmts.getBySlug.get(slug);
    if (!row) return null;
    stmts.incrementViews.run(slug);
    return { ...row, data: JSON.parse(row.data) };
  },

  getAllRecipes() {
    return stmts.getAll.all();
  },

  getByCategory(category) {
    return stmts.getByCategory.all(category);
  },

  getRecentRecipes() {
    return stmts.getRecent.all();
  },

  searchRecipes(query) {
    const q = `%${query}%`;
    return stmts.search.all(q, q, q);
  },

  getTotalCount() {
    return stmts.count.get().total;
  }
};

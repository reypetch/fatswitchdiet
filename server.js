require('dotenv').config();
const express  = require('express');
const path     = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const slugify  = require('slugify');
const db       = require('./db/database');
const { getUnsplashImage } = require('./utils/images');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ── Claude Client ────────────────────────────────────────────
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helper ───────────────────────────────────────────────────
function makeSlug(title) {
  return slugify(title, { lower: true, strict: true, trim: true });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

// ── CLAUDE PROMPT ────────────────────────────────────────────
function buildPrompt(keyword, cuisine, dietary) {
  return `You are a professional nutritionist and recipe developer for FatSwitchDiet.com.
Your specialty is creating indulgent international recipes alongside a "Fat Switch" — smart ingredient swaps that cut 30–45% of calories while preserving full flavor.

Generate a complete recipe for: "${keyword}"
Cuisine preference: ${cuisine || 'Any international cuisine'}
Dietary note: ${dietary || 'None'}

Return ONLY valid JSON. No markdown. No backticks. No preamble. Exact structure below:

{
  "title": "Recipe Title (catchy, SEO-optimised, max 60 chars)",
  "description": "2-3 sentence enticing description mentioning the Fat Switch calorie savings",
  "category": "Breakfast or Lunch or Dinner or Snack or Dessert",
  "cuisine": "e.g. Italian, Korean, Thai, Western, Japanese",
  "prep_time": 20,
  "cook_time": 30,
  "servings": 4,
  "difficulty": "Easy or Medium or Hard",
  "fat_switch": {
    "original_kcal": 580,
    "switched_kcal": 350,
    "savings_kcal": 230,
    "savings_pct": 40,
    "headline": "One punchy sentence about the swap benefit",
    "swaps": [
      {
        "original": "Full-fat cream (1 cup)",
        "switched": "Greek yogurt (3/4 cup)",
        "reason": "Same creaminess, 60% less saturated fat"
      }
    ]
  },
  "why_love": [
    { "icon": "✅", "title": "Short title", "detail": "One sentence explanation" }
  ],
  "ingredients": {
    "main": ["2 cups ingredient", "1 tsp ingredient"],
    "filling_or_sauce": ["200g ingredient", "1/2 cup ingredient"]
  },
  "instructions": [
    { "title": "Step title", "detail": "Clear, detailed instruction for this step." }
  ],
  "nutrition": {
    "original": { "calories": 580, "protein": 18, "carbs": 52, "fat": 28, "sat_fat": 14 },
    "switched": { "calories": 350, "protein": 22, "carbs": 48, "fat": 10, "sat_fat": 3.5 }
  },
  "pro_tips": [
    { "icon": "🌡️", "title": "Tip title", "detail": "Practical tip from kitchen testing." }
  ],
  "origin": "2-3 paragraphs about the dish's cultural origin and why this Fat Switch version works.",
  "faq": [
    { "q": "Question about this specific recipe?", "a": "Clear, helpful answer." }
  ],
  "related_keywords": ["keyword1", "keyword2", "keyword3"],
  "meta_description": "SEO meta description under 155 characters"
}

Requirements:
- why_love: exactly 4 items
- ingredients main: 6-10 items, filling_or_sauce: 4-8 items
- instructions: 6-10 steps
- pro_tips: exactly 5 items
- faq: exactly 5 Q&A pairs
- related_keywords: exactly 3 items
- All numbers must be realistic and accurate
- Fat Switch savings must be 30-45% calorie reduction`;
}

// ════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════

// ── Homepage ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  const categories = db.getCategories();
  const featured   = db.getFeaturedRecipes();
  const recent     = db.getRecentRecipes();
  const total      = db.getTotalCount();
  res.render('index', { categories, featured, recent, recipes: recent, total, formatDate, page: 'home' });
});

// ── Generator Page ───────────────────────────────────────────
app.get('/generator', (req, res) => {
  res.render('generator', { page: 'generator', categories: db.getCategories() });
});

// ── Recipe Page (SSR for SEO) ─────────────────────────────────
app.get('/recipe/:slug', (req, res) => {
  const recipe = db.getRecipe(req.params.slug);
  if (!recipe) return res.status(404).render('404', { page: '404', categories: db.getCategories() });

  // Flatten data JSON fields onto recipe for template compatibility
  if (recipe.data) {
    Object.assign(recipe, recipe.data);
    // Flatten ingredients: { main, filling_or_sauce } → flat array
    if (recipe.ingredients && !Array.isArray(recipe.ingredients)) {
      recipe.ingredients = [
        ...(Array.isArray(recipe.ingredients.main)             ? recipe.ingredients.main             : []),
        ...(Array.isArray(recipe.ingredients.filling_or_sauce) ? recipe.ingredients.filling_or_sauce : []),
      ];
    }
    // Flatten instructions: [{ title, detail }] → ["Title: detail"]
    if (Array.isArray(recipe.instructions)) {
      recipe.instructions = recipe.instructions.map(s =>
        typeof s === 'string' ? s : `${s.title}: ${s.detail}`
      );
    }
    // Pull nutrition into top-level fields (prefer switched, fall back to original)
    const nutSrc = recipe.nutrition?.switched || recipe.nutrition?.original;
    if (nutSrc) {
      if (!recipe.calories) recipe.calories = nutSrc.calories;
      if (!recipe.protein)  recipe.protein  = nutSrc.protein;
      if (!recipe.carbs)    recipe.carbs    = nutSrc.carbs;
      if (!recipe.fat)      recipe.fat      = nutSrc.fat;
      if (!recipe.fiber)    recipe.fiber    = nutSrc.fiber;
    }
  }
  // category_name / category_slug for breadcrumb
  recipe.category_name = recipe.category_name || recipe.category;
  recipe.category_slug = recipe.category_slug || (recipe.category || '').toLowerCase();

  console.log(`[recipe] ${recipe.slug} image_url=${recipe.image_url || 'none'}`);
  const related = db.getRecentRecipes(6).filter(r => r.slug !== recipe.slug).slice(0, 3);
  res.render('recipe', { recipe, formatDate, page: 'recipe', categories: db.getCategories(), related });
});

// ── Category Page ─────────────────────────────────────────────
app.get('/category/:cat', (req, res) => {
  const categories = db.getCategories();
  const catSlug    = req.params.cat.toLowerCase();
  const category   = categories.find(c => c.slug === catSlug)
                  || { name: req.params.cat.charAt(0).toUpperCase() + req.params.cat.slice(1), slug: catSlug, icon: '🍽️', description: '' };
  const recipes    = db.getByCategory(category.name);
  res.render('category', { recipes, category, formatDate, page: 'category', categories });
});

// ── Static Pages ──────────────────────────────────────────────
app.get('/about',          (req, res) => res.render('about',      { page: 'about',      categories: db.getCategories() }));
app.get('/contact',        (req, res) => res.render('contact',    { page: 'contact',    categories: db.getCategories() }));
app.get('/privacy-policy', (req, res) => res.render('privacy',    { page: 'privacy',    categories: db.getCategories() }));
app.get('/privacy',        (req, res) => res.render('privacy',    { page: 'privacy',    categories: db.getCategories() }));
app.get('/diet-plan',      (req, res) => res.render('diet-plan',  { page: 'diet-plan',  categories: db.getCategories(), plans: [] }));

// ════════════════════════════════════════════════════════════
//  API ROUTES
// ════════════════════════════════════════════════════════════

// ── POST /api/generate-recipe (used by restored generator.ejs) ───────────────
app.post('/api/generate-recipe', async (req, res) => {
  const { prompt, category, servings, dietary, adminKey } = req.body;
  const isAdmin = adminKey === 'fatswitchdev2026';

  if (!prompt || prompt.trim().length < 2) {
    return res.status(400).json({ error: 'Please describe what you would like to eat.' });
  }

  const dietaryStr = Array.isArray(dietary) ? dietary.join(', ') : (dietary || '');

  try {
    const message = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildPrompt(prompt.trim(), category, dietaryStr) }]
    });

    const raw   = message.content[0].text.trim();
    const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const data  = JSON.parse(clean);

    if (!data.title || !data.ingredients || !data.instructions) {
      throw new Error('Incomplete recipe data returned.');
    }

    // Flatten ingredients from rich { main, filling_or_sauce } to string array
    const ingredients = [
      ...(Array.isArray(data.ingredients) ? data.ingredients : []),
      ...(Array.isArray(data.ingredients?.main) ? data.ingredients.main : []),
      ...(Array.isArray(data.ingredients?.filling_or_sauce) ? data.ingredients.filling_or_sauce : []),
    ];

    // Flatten instructions from [{ title, detail }] or [string] to string array
    const instructions = (Array.isArray(data.instructions) ? data.instructions : []).map(s =>
      typeof s === 'string' ? s : `${s.title}: ${s.detail}`
    );

    const slug = makeSlug(data.title);

    if (isAdmin) {
      db.saveRecipe({
        slug,
        title:    data.title,
        category: category || data.category || 'Dinner',
        cuisine:  data.cuisine  || 'International',
        keyword:  prompt.trim(),
        data
      });
      return res.json({ success: true, recipe: { ...data, slug, ingredients, instructions } });
    }

    res.json({ success: true, recipe: { ...data, slug: null, ingredients, instructions } });

  } catch (err) {
    console.error('Generate-recipe error:', err.message);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned unexpected format. Please try again.' });
    }
    res.status(500).json({ error: 'Generation failed. Please try again in a moment.' });
  }
});

// ── POST /api/generate ────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { keyword, cuisine, dietary } = req.body;

  if (!keyword || keyword.trim().length < 2) {
    return res.status(400).json({ error: 'Please enter a recipe keyword.' });
  }

  try {
    const message = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role:    'user',
        content: buildPrompt(keyword.trim(), cuisine, dietary)
      }]
    });

    const raw = message.content[0].text.trim();

    // Strip any accidental markdown fences
    const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const data  = JSON.parse(clean);

    // Validate essential fields
    if (!data.title || !data.ingredients || !data.instructions) {
      throw new Error('Incomplete recipe data returned.');
    }

    const slug = makeSlug(data.title);
    const isAdmin = req.body.adminKey === 'fatswitchdev2026';

    if (isAdmin) {
      db.saveRecipe({
        slug,
        title:   data.title,
        category: data.category || 'Dinner',
        cuisine:  data.cuisine  || 'International',
        keyword:  keyword.trim(),
        data
      });
      return res.json({ success: true, slug, title: data.title });
    }

    res.json({ success: true, slug: null, data, savedToDB: false });

  } catch (err) {
    console.error('Generate error:', err.message);

    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned unexpected format. Please try again.' });
    }
    res.status(500).json({ error: 'Generation failed. Please try again in a moment.' });
  }
});

// ── GET /api/recipe/:slug (JSON) ──────────────────────────────
app.get('/api/recipe/:slug', (req, res) => {
  const recipe = db.getRecipe(req.params.slug);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
  res.json(recipe);
});

// ── GET /api/recipes (list) ───────────────────────────────────
app.get('/api/recipes', (req, res) => {
  const { q, category } = req.query;
  let recipes;
  if (q)        recipes = db.searchRecipes(q);
  else if (category) recipes = db.getByCategory(category);
  else          recipes = db.getAllRecipes();
  res.json(recipes);
});

// ── GET /api/search ───────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  res.json(db.searchRecipes(q));
});

// ── POST /api/generate-plan ───────────────────────────────────
app.post('/api/generate-plan', async (req, res) => {
  const { goal, activity, prefs, weight, target, name } = req.body;

  if (!goal) return res.status(400).json({ error: 'Please complete all steps.' });

  // Estimate daily calories (simple Harris-Benedict approximation)
  const activityMult = { sedentary: 1.2, moderate: 1.55, active: 1.725 };
  const mult    = activityMult[activity] || 1.375;
  const bmr     = 10 * (weight || 70) + 500;          // simplified
  let   tdee    = Math.round(bmr * mult);
  if (goal === 'lose_fat')     tdee = Math.round(tdee * 0.8);
  if (goal === 'build_muscle') tdee = Math.round(tdee * 1.1);

  const dailyProtein = goal === 'build_muscle' ? Math.round((weight || 70) * 2.2) :
                       goal === 'lose_fat'      ? Math.round((weight || 70) * 1.8) :
                                                  Math.round((weight || 70) * 1.4);

  const prefStr = (prefs && prefs.length) ? prefs.join(', ') : 'no restrictions';

  const prompt = `You are a professional nutritionist for FatSwitchDiet.com, experts in healthy ingredient swaps.

Create a personalised 7-day meal plan for:
- Goal: ${goal}
- Daily Calorie Target: ${tdee} kcal
- Daily Protein Target: ${dailyProtein}g
- Food preferences: ${prefStr}
- Current weight: ${weight}kg → Target: ${target}kg

Return ONLY valid JSON. No markdown. No backticks. No extra text. Exact structure:

{
  "daily_calories": ${tdee},
  "daily_protein": ${dailyProtein},
  "days": [
    {
      "theme": "Energising Start",
      "total_kcal": 1480,
      "tip": "One practical diet or lifestyle tip for this day",
      "meals": [
        {
          "type": "Breakfast",
          "name": "Meal name",
          "description": "Brief description with portion size",
          "fat_switch_tip": "One Fat Switch swap tip for this meal",
          "kcal": 380
        },
        { "type": "Lunch", "name": "...", "description": "...", "fat_switch_tip": "...", "kcal": 420 },
        { "type": "Snack", "name": "...", "description": "...", "fat_switch_tip": "...", "kcal": 180 },
        { "type": "Dinner", "name": "...", "description": "...", "fat_switch_tip": "...", "kcal": 500 }
      ]
    }
  ]
}

Requirements:
- Exactly 7 days
- Each day has exactly 4 meals: Breakfast, Lunch, Snack, Dinner
- Every meal must have a fat_switch_tip (a specific smart swap for that meal)
- Each day's theme should be different and motivating
- Vary cuisines across the 7 days (mix Asian, Western, Mediterranean etc)
- All calorie numbers must add up realistically
- Keep meals practical and easy to prepare`;

  try {
    const message = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw   = message.content[0].text.trim();
    const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const plan  = JSON.parse(clean);

    if (!plan.days || plan.days.length !== 7) {
      throw new Error('Invalid plan structure from AI.');
    }

    res.json({ success: true, plan });

  } catch (err) {
    console.error('Diet plan error:', err.message);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned unexpected format. Please try again.' });
    }
    res.status(500).json({ error: 'Plan generation failed. Please try again in a moment.' });
  }
});

// ── POST /api/generate-diet-plan ─────────────────────────────
app.post('/api/generate-diet-plan', async (req, res) => {
  const { goal, duration, calories, restrictions } = req.body;

  if (!goal) return res.status(400).json({ error: 'Please select a goal.' });

  const durationDays = parseInt(duration) || 7;
  const calorieTarget = parseInt(calories) || null;
  const restrictStr = Array.isArray(restrictions) && restrictions.length
    ? restrictions.join(', ')
    : 'None';

  const prompt = `You are a professional nutritionist for FatSwitchDiet.com, specialising in healthy ingredient swaps.

Create a personalised ${durationDays}-day meal plan for:
- Goal: ${goal}
- Daily calorie target: ${calorieTarget ? calorieTarget + ' kcal' : 'auto (choose appropriate for goal)'}
- Dietary restrictions: ${restrictStr}

Return ONLY valid JSON. No markdown, no backticks, no extra text. Exact structure:

{
  "name": "Catchy plan name (e.g. '7-Day Fat Switch Reset')",
  "description": "2-3 sentence summary of the plan and its benefits",
  "duration_days": ${durationDays},
  "calories_per_day": 1800,
  "goal": "${goal}",
  "meal_plan": [
    {
      "day": 1,
      "breakfast": { "name": "Meal name", "calories": 380, "notes": "Brief fat-switch tip" },
      "lunch":     { "name": "Meal name", "calories": 450, "notes": "Brief fat-switch tip" },
      "dinner":    { "name": "Meal name", "calories": 520, "notes": "Brief fat-switch tip" },
      "snack":     { "name": "Meal name", "calories": 180, "notes": "Brief fat-switch tip" }
    }
  ]
}

Requirements:
- Exactly ${durationDays} entries in meal_plan (day 1 through ${durationDays})
- Every day must have breakfast, lunch, dinner, and snack
- Vary meals — no repeated dishes across the plan
- All calorie numbers must be realistic and consistent with calories_per_day
- Keep meals practical and easy to prepare`;

  try {
    const message = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw   = message.content[0].text.trim();
    const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const plan  = JSON.parse(clean);

    if (!plan.meal_plan || !Array.isArray(plan.meal_plan) || plan.meal_plan.length === 0) {
      throw new Error('Invalid plan structure from AI.');
    }

    res.json({ success: true, plan });

  } catch (err) {
    console.error('Diet plan error:', err.message);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned unexpected format. Please try again.' });
    }
    res.status(500).json({ error: 'Plan generation failed. Please try again in a moment.' });
  }
});

// ════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════

const ADMIN_KEY = 'fatswitchdev2026';
const checkAdmin = (req, res) => {
  if (req.query.key !== ADMIN_KEY) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
};

// ── GET /admin/db-status ──────────────────────────────────────
app.get('/admin/db-status', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const total      = db.get('SELECT COUNT(*) as n FROM recipes').n;
  const withImages = db.get("SELECT COUNT(*) as n FROM recipes WHERE image_url IS NOT NULL AND image_url != ''").n;
  const sample     = db.prepare('SELECT title, image_url FROM recipes ORDER BY id LIMIT 3').all();
  res.json({ total_recipes: total, with_images: withImages, without_images: total - withImages, sample });
});

// ── GET /admin/recipes ────────────────────────────────────────
app.get('/admin/recipes', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send('Forbidden');
  const recipes = db.prepare(`
    SELECT r.id, r.title, r.slug, r.created_at, r.image_url, c.name as category
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    ORDER BY r.id DESC
  `).all();
  const key  = req.query.key;
  const rows = recipes.map((r) => `
    <tr>
      <td>${r.id}</td>
      <td><a href="/recipe/${r.slug}" target="_blank">${r.title}</a></td>
      <td>${r.category || '—'}</td>
      <td>${r.image_url ? '✓' : '✗'}</td>
      <td>${(r.created_at || '').slice(0, 16)}</td>
      <td>
        <form method="POST" action="/admin/recipes/${r.id}/delete?key=${key}" onsubmit="return confirm('Delete ${r.title.replace(/'/g, "\\'")}?')">
          <button type="submit" style="background:#e53e3e;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;">Delete</button>
        </form>
      </td>
    </tr>`).join('');
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Admin – Recipes</title>
<style>
  body{font-family:sans-serif;padding:2rem;background:#f7f7f7}
  h1{margin-bottom:1rem}
  .actions{margin-bottom:1rem;display:flex;gap:1rem;align-items:center}
  table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1)}
  th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #eee;font-size:0.9rem}
  th{background:#2d6a4f;color:#fff}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#f0fdf4}
  a{color:#2d6a4f}
</style></head>
<body>
<h1>Recipes (${recipes.length})</h1>
<div class="actions">
  <a href="/admin/db-status?key=${key}">DB Status</a>
  <a href="/admin/dedupe?key=${key}" onclick="return confirm('Remove all duplicates?')">Run Dedupe</a>
  <a href="/admin/refresh-images?key=${key}" target="_blank">Refresh Images</a>
  <a href="/admin/run-seed?key=${key}" target="_blank">Run Seed</a>
</div>
<table>
  <thead><tr><th>ID</th><th>Title</th><th>Category</th><th>Image</th><th>Created</th><th>Action</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`);
});

// ── POST /admin/recipes/:id/delete ────────────────────────────
app.post('/admin/recipes/:id/delete', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send('Forbidden');
  db.prepare('DELETE FROM recipes WHERE id = ?').run([req.params.id]);
  res.redirect(`/admin/recipes?key=${req.query.key}`);
});

// ── GET /admin/dedupe ─────────────────────────────────────────
app.get('/admin/dedupe', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const dupes = db.prepare(`
    SELECT id, title FROM recipes
    WHERE LOWER(title) IN (
      SELECT LOWER(title) FROM recipes GROUP BY LOWER(title) HAVING COUNT(*) > 1
    )
    AND id NOT IN (
      SELECT MAX(id) FROM recipes GROUP BY LOWER(title)
    )
  `).all();
  if (dupes.length === 0) return res.json({ removed: 0, message: 'No duplicates found.' });
  const ids = dupes.map((r) => r.id);
  db.prepare(`DELETE FROM recipes WHERE id IN (${ids.map(() => '?').join(',')})`).run(ids);
  res.json({ removed: dupes.length, titles: dupes.map((r) => r.title) });
});

// ── Admin seed helper ─────────────────────────────────────────
const SEED_RECIPES = [
  { prompt: 'teriyaki salmon bowl',             category: 'Dinner',    servings: 2 },
  { prompt: 'creamy chicken alfredo',            category: 'Dinner',    servings: 4 },
  { prompt: 'korean beef bulgogi',               category: 'Dinner',    servings: 4 },
  { prompt: 'thai green curry chicken',          category: 'Dinner',    servings: 4 },
  { prompt: 'garlic butter shrimp pasta',        category: 'Dinner',    servings: 2 },
  { prompt: 'mexican chicken burrito bowl',      category: 'Dinner',    servings: 4 },
  { prompt: 'japanese gyudon beef rice',         category: 'Dinner',    servings: 2 },
  { prompt: 'honey garlic pork tenderloin',      category: 'Dinner',    servings: 4 },
  { prompt: 'fluffy japanese pancakes',          category: 'Breakfast', servings: 2 },
  { prompt: 'avocado egg toast',                 category: 'Breakfast', servings: 1 },
  { prompt: 'greek yogurt parfait',              category: 'Breakfast', servings: 1 },
  { prompt: 'banana oat smoothie bowl',          category: 'Breakfast', servings: 1 },
  { prompt: 'scrambled eggs with smoked salmon', category: 'Breakfast', servings: 2 },
  { prompt: 'overnight oats',                    category: 'Breakfast', servings: 1 },
  { prompt: 'vietnamese chicken pho',            category: 'Lunch',     servings: 2 },
  { prompt: 'mediterranean quinoa salad',        category: 'Lunch',     servings: 2 },
  { prompt: 'chicken caesar wrap',               category: 'Lunch',     servings: 1 },
  { prompt: 'tom yum soup',                      category: 'Lunch',     servings: 2 },
  { prompt: 'spicy tuna poke bowl',              category: 'Lunch',     servings: 1 },
  { prompt: 'chocolate lava cake',               category: 'Desserts',  servings: 2 },
  { prompt: 'mango sticky rice',                 category: 'Desserts',  servings: 2 },
  { prompt: 'tiramisu lightened',                category: 'Desserts',  servings: 6 },
  { prompt: 'protein energy balls',              category: 'Snacks',    servings: 12 },
  { prompt: 'baked sweet potato chips',          category: 'Snacks',    servings: 2 },
  { prompt: 'almond butter apple slices',        category: 'Snacks',    servings: 1 },
];

async function generateAndSaveRecipe(prompt, category, servings = 4, dietary = []) {
  const dietaryStr = dietary.length ? `Dietary requirements: ${dietary.join(', ')}.` : '';
  const userPrompt = `Create a detailed ${category || 'healthy'} recipe for: "${prompt}"
Servings: ${servings}. ${dietaryStr}

Respond ONLY with valid JSON in this exact format:
{
  "title": "Recipe Title",
  "description": "2-3 sentence description",
  "prep_time": 10,
  "cook_time": 20,
  "servings": ${servings},
  "calories": 350,
  "protein": 28,
  "carbs": 30,
  "fat": 12,
  "fiber": 6,
  "ingredients": ["ingredient 1 with amount", "ingredient 2 with amount"],
  "instructions": ["Step 1 description", "Step 2 description"],
  "tags": ["tag1", "tag2", "tag3"]
}`;

  const message = await claude.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: 'You are a professional nutritionist and chef specializing in the Fat Switch Diet. Create healthy, delicious recipes that optimize metabolism and fat-burning.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw   = message.content[0].text.trim();
  const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  const r     = JSON.parse(clean);

  const slug     = makeSlug(r.title) + '-' + Date.now();
  const catRow   = db.prepare('SELECT id FROM categories WHERE name LIKE ?').get([`%${category}%`]);
  const imageUrl = await getUnsplashImage(r.title);

  db.prepare(`
    INSERT OR IGNORE INTO recipes
      (title, slug, description, ingredients, instructions, category_id,
       prep_time, cook_time, servings, calories, protein, carbs, fat, fiber,
       tags, image_url, ai_generated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run([
    r.title, slug, r.description,
    JSON.stringify(r.ingredients), JSON.stringify(r.instructions),
    catRow?.id || null, r.prep_time, r.cook_time, r.servings,
    r.calories, r.protein, r.carbs, r.fat, r.fiber,
    JSON.stringify(r.tags || []), imageUrl,
  ]);

  return { ...r, slug, image_url: imageUrl };
}

// ── GET /admin/run-seed ───────────────────────────────────────
app.get('/admin/run-seed', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const skip  = Math.max(0, parseInt(req.query.skip || '0', 10));
  const batch = SEED_RECIPES.slice(skip);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();

  const write = (line) => res.write(line + '\n');
  write(`=== FatSwitchDiet Admin Seed ===`);
  write(`Total: ${SEED_RECIPES.length} | Skipping: ${skip} | Generating: ${batch.length}`);
  write('');

  let ok = 0, fail = 0;
  for (let i = 0; i < batch.length; i++) {
    const { prompt, category, servings } = batch[i];
    const label = `[${skip + i + 1}/${SEED_RECIPES.length}] ${prompt} (${category})`;
    try {
      const recipe = await generateAndSaveRecipe(prompt, category, servings);
      write(`✓ ${label} → "${recipe.title}"`);
      ok++;
    } catch (err) {
      write(`✗ ${label} → ${err.message}`);
      fail++;
    }
    if (i < batch.length - 1) await new Promise((r) => setTimeout(r, 3000));
  }

  write('');
  write(`=== Seeding done: ${ok} succeeded, ${fail} failed ===`);

  const missing = db.prepare("SELECT id, title FROM recipes WHERE image_url IS NULL OR image_url = '' ORDER BY id").all();
  if (missing.length > 0) {
    write('');
    write(`=== Backfilling images for ${missing.length} recipes ===`);
    let imgOk = 0, imgFail = 0;
    for (let i = 0; i < missing.length; i++) {
      const { id, title } = missing[i];
      try {
        const url = await getUnsplashImage(title);
        db.prepare('UPDATE recipes SET image_url = ? WHERE id = ?').run([url, id]);
        write(`  img ✓ ${title}`);
        imgOk++;
      } catch (err) {
        write(`  img ✗ ${title} → ${err.message}`);
        imgFail++;
      }
      if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
    write(`=== Images done: ${imgOk} updated, ${imgFail} failed ===`);
  } else {
    write('All recipes already have images.');
  }
  res.end();
});

// ── GET /admin/refresh-images ─────────────────────────────────
app.get('/admin/refresh-images', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();

  const write   = (line) => res.write(line + '\n');
  const recipes = db.prepare('SELECT id, title FROM recipes ORDER BY id').all();
  write(`=== Refreshing images for ALL ${recipes.length} recipes ===\n`);

  let ok = 0, fail = 0;
  for (let i = 0; i < recipes.length; i++) {
    const { id, title } = recipes[i];
    try {
      const url = await getUnsplashImage(title);
      db.prepare('UPDATE recipes SET image_url = ? WHERE id = ?').run([url, id]);
      write(`✓ [${i + 1}/${recipes.length}] ${title}`);
      ok++;
    } catch (err) {
      write(`✗ [${i + 1}/${recipes.length}] ${title} → ${err.message}`);
      fail++;
    }
    if (i < recipes.length - 1) await new Promise((r) => setTimeout(r, 500));
  }
  write(`\n=== Done: ${ok} updated, ${fail} failed ===`);
  res.end();
});

// ── GET /sitemap.xml ──────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
  const base    = `${req.protocol}://${req.get('host')}`;
  const recipes = db.prepare('SELECT slug, created_at FROM recipes ORDER BY created_at DESC').all();
  const urls    = recipes.map((r) => {
    const lastmod = (r.created_at || '').split('T')[0] || new Date().toISOString().split('T')[0];
    return `  <url>\n    <loc>${base}/recipe/${r.slug}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>0.8</priority>\n  </url>`;
  }).join('\n');
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});

// ── 404 fallback ──────────────────────────────────────────────
app.use((req, res) => res.status(404).render('404', { page: '404', categories: db.getCategories() }));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ FatSwitchDiet running on http://localhost:${PORT}`);
});

require('dotenv').config();
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const slugify = require('slugify');
const db = require('./db/database');
const { getUnsplashImage } = require('./utils/images');

// Ensure image_url column exists (safe migration)
try { db.run('ALTER TABLE recipes ADD COLUMN image_url TEXT'); } catch (_) {}


const app = express();
const PORT = process.env.PORT || 3000;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many AI requests. Please try again later.' },
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY name').all();
}

function parseRecipe(recipe) {
  if (!recipe) return null;
  return {
    ...recipe,
    ingredients: JSON.parse(recipe.ingredients || '[]'),
    instructions: JSON.parse(recipe.instructions || '[]'),
    tags: JSON.parse(recipe.tags || '[]'),
  };
}

// ─── Pages ─────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  const featured = db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    WHERE r.featured = 1 ORDER BY r.created_at DESC LIMIT 6
  `).all().map(parseRecipe);

  const recent = db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    ORDER BY r.created_at DESC LIMIT 8
  `).all().map(parseRecipe);

  res.render('index', { featured, recent, categories: getCategories(), page: 'home' });
});

app.get('/recipe/:slug', (req, res) => {
  const recipe = db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    WHERE r.slug = ?
  `).get(req.params.slug);

  if (!recipe) return res.status(404).render('404', { categories: getCategories(), page: '404' });

  const related = db.prepare(`
    SELECT r.*, c.name as category_name FROM recipes r
    LEFT JOIN categories c ON r.category_id = c.id
    WHERE r.category_id = ? AND r.id != ? LIMIT 3
  `).all(recipe.category_id, recipe.id).map(parseRecipe);

  res.render('recipe', { recipe: parseRecipe(recipe), related, categories: getCategories(), page: 'recipe' });
});

app.get('/category/:slug', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!category) return res.status(404).render('404', { categories: getCategories(), page: '404' });

  const recipes = db.prepare(`
    SELECT r.*, c.name as category_name, c.slug as category_slug
    FROM recipes r LEFT JOIN categories c ON r.category_id = c.id
    WHERE r.category_id = ? ORDER BY r.created_at DESC
  `).all(category.id).map(parseRecipe);

  res.render('category', { category, recipes, categories: getCategories(), page: 'category' });
});

app.get('/generator', (req, res) => {
  res.render('generator', { categories: getCategories(), page: 'generator' });
});

app.get('/diet-plan', (req, res) => {
  const plans = db.prepare('SELECT * FROM diet_plans ORDER BY created_at DESC LIMIT 6').all();
  res.render('diet-plan', { plans, categories: getCategories(), page: 'diet-plan' });
});

app.get('/about', (req, res) => res.render('about', { categories: getCategories(), page: 'about' }));
app.get('/contact', (req, res) => res.render('contact', { categories: getCategories(), page: 'contact' }));
app.get('/privacy', (req, res) => res.render('privacy', { categories: getCategories(), page: 'privacy' }));

app.get('/google3e9b317ccdb7eb55.html', (req, res) => {
  res.type('text/html').send('google-site-verification: google3e9b317ccdb7eb55.html');
});

app.get('/admin/db-status', (req, res) => {
  if (req.query.key !== 'fatswitchdev2026') return res.status(403).json({ error: 'Forbidden' });
  const total = db.prepare('SELECT COUNT(*) as n FROM recipes').get().n;
  const withImages = db.prepare("SELECT COUNT(*) as n FROM recipes WHERE image_url IS NOT NULL AND image_url != ''").get().n;
  const sample = db.prepare("SELECT title, image_url FROM recipes ORDER BY id LIMIT 3").all();
  res.json({
    total_recipes: total,
    with_images: withImages,
    without_images: total - withImages,
    sample,
  });
});

app.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const recipes = db.prepare('SELECT slug, created_at FROM recipes ORDER BY created_at DESC').all();

  const urls = recipes.map((r) => {
    const lastmod = r.created_at ? r.created_at.split(' ')[0].split('T')[0] : new Date().toISOString().split('T')[0];
    return `  <url>
    <loc>${base}/recipe/${r.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <priority>0.8</priority>
  </url>`;
  }).join('\n');

  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`);
});

// ─── AI API Endpoints ───────────────────────────────────────────────────────

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

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: 'You are a professional nutritionist and chef specializing in the Fat Switch Diet — a science-based approach to weight management through strategic food choices. Create healthy, delicious recipes that optimize metabolism and fat-burning.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const jsonMatch = message.content[0].text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid response format from AI');
  const recipeData = JSON.parse(jsonMatch[0]);

  const slug = slugify(recipeData.title, { lower: true, strict: true }) + '-' + Date.now();
  const catRow = db.prepare('SELECT id FROM categories WHERE name LIKE ?').get([`%${category}%`]);
  const imageUrl = await getUnsplashImage(recipeData.title);

  db.prepare(`
    INSERT INTO recipes (title, slug, description, ingredients, instructions, category_id, prep_time, cook_time, servings, calories, protein, carbs, fat, fiber, tags, image_url, ai_generated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run([
    recipeData.title, slug, recipeData.description,
    JSON.stringify(recipeData.ingredients), JSON.stringify(recipeData.instructions),
    catRow?.id || null, recipeData.prep_time, recipeData.cook_time, recipeData.servings,
    recipeData.calories, recipeData.protein, recipeData.carbs, recipeData.fat, recipeData.fiber,
    JSON.stringify(recipeData.tags || []), imageUrl,
  ]);

  return { ...recipeData, slug, image_url: imageUrl };
}

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

app.post('/admin/run-seed', async (req, res) => {
  if (req.query.key !== 'fatswitchdev2026') return res.status(403).json({ error: 'Forbidden' });

  const skip = Math.max(0, parseInt(req.query.skip || '0', 10));
  const batch = SEED_RECIPES.slice(skip);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();

  const write = (line) => res.write(line + '\n');
  write(`=== FatSwitchDiet Admin Seed ===`);
  write(`Total recipes: ${SEED_RECIPES.length} | Skipping first: ${skip} | To generate: ${batch.length}`);
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

  // Backfill images for any recipes still missing one
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

app.post('/api/generate-recipe', aiLimiter, async (req, res) => {
  try {
    const { prompt, category, servings = 4, dietary = [] } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const recipe = await generateAndSaveRecipe(prompt, category, servings, dietary);
    res.json({ success: true, recipe });
  } catch (err) {
    console.error('Recipe generation error:', err);
    res.status(500).json({ error: 'Failed to generate recipe. Please try again.' });
  }
});

app.post('/api/generate-diet-plan', aiLimiter, async (req, res) => {
  try {
    const { goal, duration = 7, calories, restrictions = [] } = req.body;
    if (!goal) return res.status(400).json({ error: 'Goal is required' });

    const restrictStr = restrictions.length ? `Dietary restrictions: ${restrictions.join(', ')}.` : '';

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: 'You are a certified nutritionist specializing in the Fat Switch Diet method. Create personalized, science-backed meal plans.',
      messages: [{
        role: 'user',
        content: `Create a ${duration}-day Fat Switch Diet meal plan for goal: "${goal}".
Target calories: ${calories || 'auto-calculate for goal'}. ${restrictStr}

Respond ONLY with valid JSON:
{
  "name": "Plan Name",
  "description": "Plan overview 2-3 sentences",
  "goal": "${goal}",
  "duration_days": ${duration},
  "calories_per_day": 1800,
  "meal_plan": [
    {
      "day": 1,
      "breakfast": {"name": "Meal name", "calories": 400, "notes": "brief note"},
      "lunch": {"name": "Meal name", "calories": 500, "notes": "brief note"},
      "dinner": {"name": "Meal name", "calories": 600, "notes": "brief note"},
      "snack": {"name": "Snack name", "calories": 200, "notes": "brief note"}
    }
  ]
}`
      }],
    });

    const content = message.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid response format');

    const planData = JSON.parse(jsonMatch[0]);
    const slug = slugify(planData.name, { lower: true, strict: true }) + '-' + Date.now();

    db.prepare(`
      INSERT INTO diet_plans (name, slug, description, duration_days, calories_per_day, goal, meal_plan, ai_generated)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run([planData.name, slug, planData.description, planData.duration_days, planData.calories_per_day, planData.goal, JSON.stringify(planData.meal_plan)]);

    res.json({ success: true, plan: planData });
  } catch (err) {
    console.error('Diet plan generation error:', err);
    res.status(500).json({ error: 'Failed to generate diet plan. Please try again.' });
  }
});

// ─── 404 ────────────────────────────────────────────────────────────────────

app.use((req, res) => res.status(404).render('404', { categories: getCategories(), page: '404' }));

app.listen(PORT, () => console.log(`FatSwitchDiet v2 running at http://localhost:${PORT}`));

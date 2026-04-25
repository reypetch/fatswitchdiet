require('dotenv').config();
const express  = require('express');
const path     = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const slugify  = require('slugify');
const db       = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;

const ADMIN_KEY = 'fatswitchdev2026';

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
  const recent = db.getRecentRecipes();
  const total  = db.getTotalCount();
  res.render('index', { recipes: recent, total, formatDate });
});

// ── Generator Page ───────────────────────────────────────────
// FIX: Pass isAdmin flag to template based on query param
app.get('/generator', (req, res) => {
  const isAdmin = req.query.admin === ADMIN_KEY;
  res.render('generator', { isAdmin });
});

// ── Recipe Page (SSR for SEO) ─────────────────────────────────
app.get('/recipe/:slug', (req, res) => {
  const recipe = db.getRecipe(req.params.slug);
  if (!recipe) return res.status(404).render('404');
  res.render('recipe', { recipe, formatDate });
});

// ── Category Page ─────────────────────────────────────────────
app.get('/category/:cat', (req, res) => {
  const cat = req.params.cat.charAt(0).toUpperCase() + req.params.cat.slice(1);
  const recipes = db.getByCategory(cat);
  res.render('category', { recipes, category: cat, formatDate });
});

// ── Static Pages ──────────────────────────────────────────────
app.get('/about',          (req, res) => res.render('about'));
app.get('/contact',        (req, res) => res.render('contact'));
app.get('/privacy-policy', (req, res) => res.render('privacy'));
app.get('/diet-plan',      (req, res) => res.render('diet-plan'));

// ════════════════════════════════════════════════════════════
//  API ROUTES
// ════════════════════════════════════════════════════════════

// ── POST /api/generate ────────────────────────────────────────
// FIX: Only saves to DB when valid adminKey is provided in request body
app.post('/api/generate', async (req, res) => {
  const { keyword, cuisine, dietary, adminKey } = req.body;

  if (!keyword || keyword.trim().length < 2) {
    return res.status(400).json({ error: 'Please enter a recipe keyword.' });
  }

  // FIX: Check admin key from request body
  const isAdmin = adminKey === ADMIN_KEY;

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

    if (isAdmin) {
      // FIX: Only save to DB when admin
      db.saveRecipe({
        slug,
        title:    data.title,
        category: data.category || 'Dinner',
        cuisine:  data.cuisine  || 'International',
        keyword:  keyword.trim(),
        data
      });

      // FIX: Verify recipe actually saved before returning slug (prevents 404 bug)
      const saved = db.getRecipe(slug);
      if (!saved) {
        return res.status(500).json({ error: 'Recipe generated but failed to save. Please try again.' });
      }

      // Admin: return slug so frontend can redirect to the saved recipe page
      return res.json({ success: true, slug, title: data.title, savedToDB: true });
    }

    // Public: return recipe data directly (no DB save, no redirect)
    res.json({ success: true, slug: null, title: data.title, data, savedToDB: false });

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

// ── 404 fallback ──────────────────────────────────────────────
app.use((req, res) => res.status(404).render('404'));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ FatSwitchDiet running on http://localhost:${PORT}`);
});

# FatSwitchDiet — Project Brief

## Overview
Recipe website with AI-powered generation, deployed on Railway.app
URL: https://fatswitchdiet.up.railway.app

## Tech Stack
- Node.js + Express
- EJS templating
- SQLite (node-sqlite3-wasm) with persistent Railway volume
- Anthropic Claude API (claude-haiku-4-5-20251001) for recipe generation
- Unsplash API for food photography
- Deployed on Railway Hobby plan ($5/month)

## Key Features
1. AI Recipe Generator (/generator)
2. AI Diet Plan Generator (/diet-plan)
3. Auto Unsplash images per recipe
4. Admin panel for manual image replacement
5. SQLite persistent database
6. Sitemap.xml for SEO
7. Google Search Console verified

## Admin Panel URLs
- Recipes: /admin/recipes?key=fatswitchdev2026
- Dedupe: /admin/dedupe?key=fatswitchdev2026
- Refresh Images: /admin/refresh-images?key=fatswitchdev2026
- Run Seed: /admin/run-seed?key=fatswitchdev2026&skip=XX
- DB Status: /admin/db-status?key=fatswitchdev2026

## Monetisation Plan
- Target: Google AdSense approval
- Requirements: 20+ indexed pages, Privacy Policy, About, Contact
- Status: Google Search Console verified, sitemap submitted

## Content Strategy
- Target: 100+ recipes
- Mix: Western + Asian international cuisine
- Angle: Fat Switch (healthy ingredient swaps, 30-45% calorie reduction)
- Image workflow: Auto Unsplash → manual replace if not relevant

## GitHub
- Repo: github.com/reypetch/fatswitchdiet
- Auto-deploy: Railway detects push → deploys automatically

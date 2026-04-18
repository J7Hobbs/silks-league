# Silks League

Free-to-play horse racing fantasy app. Built with React + Vite + Supabase, deployed on Vercel.

---

## Stack

- **Frontend**: React (Vite), React Router, inline styles
- **Backend/Auth**: Supabase (PostgreSQL + Row Level Security)
- **Deployment**: Vercel (auto-deploys on push to `main`)
- **Fonts**: Bebas Neue (headings), DM Sans (body)
- **Colour palette**: `#0a1a08` bg · `#162a1a` card bg · `#c9a84c` gold · `#e8f0e8` off-white

---

## PWA

The app is a Progressive Web App — users can install it on iPhone and Android via the install prompt.

### ⚠️ Deploying a new build — update the service worker cache

When you push changes that users should receive immediately (new features, bug fixes), you **must bump the cache version** in `public/sw.js` so the service worker discards the old cache and fetches fresh files:

```js
// public/sw.js — line 3
const CACHE_VERSION = 'silks-v1'  // ← change to silks-v2, silks-v3, etc.
```

If you don't do this, returning users on mobile may be served stale cached files until they manually clear their browser cache.

---

## Pages

| Route | File | Notes |
|---|---|---|
| `/` | `App.jsx` | Public landing page |
| `/auth` | `pages/Auth.jsx` | Login / signup |
| `/dashboard` | `pages/Dashboard.jsx` | Main hub, live countdown |
| `/picks` | `pages/Picks.jsx` | Weekly pick submission |
| `/league` | `pages/League.jsx` | Season + weekly leaderboard |
| `/races` | `pages/Races.jsx` | Race card with runners |
| `/results` | `pages/Results.jsx` | Weekly results + scores |
| `/profile` | `pages/Profile.jsx` | User stats, badges, groups |
| `/admin` | `pages/Admin.jsx` | Admin-only race/results management |

---

## Supabase tables

`seasons` · `race_weeks` · `races` · `runners` · `picks` · `scores` · `results` · `profiles`

Profile page also expects optional `groups` and `group_members` tables (graceful fallback if absent).

---

## Development

```bash
npm install
npm run dev
```

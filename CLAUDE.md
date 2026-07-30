CONTEXT:
This is Silks League — a free-to-play fantasy horse racing web app. Users pick one horse per race across UK races each Saturday, scoring points based on finishing position and SP odds bonuses. Currently in early testing with a small user group. Live at silks-league.vercel.app.

TECH STACK:
- Frontend: React + Vite
- Backend: Supabase (project "Dashboard", ref wfytwcwletznzyayjkrv.supabase.co, West EU/London)
- Hosting: Vercel
- Design tokens: dark forest green #0a1a08 background, gold #c9a84c accent, card gradient linear-gradient(180deg, #152e12 0%, #0a1a08 100%)

WORKFLOW:
- Planning, architecture, and SQL decisions happen in a separate Claude Project (not this session)
- This session (Claude Code) is only for implementation — I'll bring you specific, scoped prompts
- Always tell me clearly what you're about to change before making edits
- Never touch files outside this repo

DATABASE NOTES:
- Two Supabase projects exist on the account — one literally named "Silks League" is STALE/unused, the other named "Dashboard" (ref wfytwcwletznzyayjkrv) is the real live production database. Always double check ref, not name.
- Festival scoring writes to BOTH festival_scores (display) and festival_day_points (leaderboard) — both must be updated together or data goes out of sync.

# Econ Games

Free, self-hosted classroom economics games for introductory microeconomics, rebuilt after economics-games.com stopped offering free access.

**Market structures** (students run firms, alone or in teams)
- Perfect competition: choose price and quantity; buyers go to the cheapest sellers first.
- Monopolistic competition: price, quantity and branding spend that builds customer loyalty.
- Oligopoly: price competition with differentiated products and random demand shocks; produce to order.
- Monopoly: students see the demand curve and choose price and quantity.

**Games of strategy**
- Repeated prisoner's dilemma (live): anonymous random partners, hidden match length (10–20 rounds by default).
- Prisoner's dilemma strategy tournament: teams describe a strategy in plain English, an AI (Gemini, free tier) turns it into code, teams test it, then a round-robin tournament runs with match-by-match results.
- Public goods: anonymous groups, partners or strangers matching, optional punishment phase.
- Ultimatum and dictator games.
- Tragedy of the commons: groups of three share a fishing lake that regrows from what is left (hidden number of seasons), with an optional anonymous group chat before each decision. A simple extract-or-wait version is a setting.
- Costs and the supply curve: teams get a bakery's (pizzeria's, coffee cart's) bills and a production table, and work through a shared five-step worksheet (sort the bills; marginal product; FC/VC/TC; AVC/AFC/ATC/MC; supply schedule) modelled on the classic cost worksheet. Anyone on a team can edit; teams can check each step. Only the supply schedule is scored: at each price, how close the team's profit is to the best possible. The instructor ends the game; an answer key and the class's average supply curve are shown at the end.
  - Sorting the bills takes two answers per bill: "Do you pay it if you close today?" (yes / no / already paid) and, for bills you pay, fixed or variable. The game then builds a list of the fixed and variable costs that students can copy straight into Excel.
  - **Assignment / practice mode** (Pace: "Any time"): the game opens as soon as it is created, with no Start button. Students join whenever they like and work on their own, then press Submit to be scored. The instructor chooses one attempt (assignment) or unlimited attempts (practice, best score counts). Closing the game scores any saved but unsubmitted work.
  - **Easy version:** only rent, insurance, workers, ingredients and packaging (no opening costs, no income given up, no per-batch energy, no card fee).
  - **Solve it on screen:** the instructor's control page has a "Solve it on screen" page with the same worksheet, for working the problem in front of the class before or after the game. It can fill in each step's answers or clear them.
- Excel-friendly tables: every cost table (in this game and in the market games) has a "Copy table" button that copies clean numbers (no $ or commas) ready to paste into Excel or Google Sheets. Pasting a block of cells from Excel into a worksheet fills its inputs down and across.

Every game also has a **demo mode** (`#/demo`, no sign-in needed): play alone against simulated players, with no timer and nothing saved.

Every game has a comprehension check, a round timer controlled from the instructor screen, a projector view, leaderboards (configurable), and CSV exports with student names, emails and IDs for grading.

## How it is hosted (all free tiers)

| Part | Where |
|---|---|
| Web pages | GitHub Pages (`site/` folder) |
| Sign-in (Google), database, live updates | Supabase |
| Game engine (ends rounds, computes results) | Supabase Edge Function `engine`, triggered every 5 seconds by `pg_cron` |
| Strategy translator | Supabase Edge Function `translate-strategy` calling Gemini |
| Keep-alive | GitHub Action pings the database every 3 days so the free project never pauses |

Rounds advance on the server, so a game keeps running if the instructor's laptop closes.

## One-time setup

1. **Google sign-in**: create an OAuth client in Google Cloud Console (type "Web application"), add the redirect URI `https://sbhalwcucckiposfrdjv.supabase.co/auth/v1/callback`, then paste the client ID and secret into Supabase → Authentication → Sign In / Providers → Google.
2. **Allowed site address**: Supabase → Authentication → URL Configuration. Set Site URL to the GitHub Pages address and add it under Redirect URLs.
3. **Gemini key** (only for the strategy tournament): get a free key at Google AI Studio and paste it on the site's Admin page.

## Running a class

1. Teach → New class. Share the six-letter class code. Students sign in with their school Google account, enter their student ID once, and join with the code.
2. New game → pick a game and settings → Create.
3. Students open the game, pass the quick check, and (for team games) form and name their own teams.
4. Start game. Use Pause, +30 seconds, End round now, and the Projector view as needed.
5. Download grades (one row per student) or all rounds (one row per student per round).

Admins (set in `private.app_config.admin_emails`) approve other instructors. Teachers with `stockton.edu` addresses are approved automatically; each instructor only sees their own classes.

## Developing locally

Requires Node 22 and a local Postgres 16.

```sh
node --test tests/engine.test.mjs                               # game logic
node --test --test-concurrency=1 tests/integration.test.mjs     # full simulated classes against Postgres
PORT=8787 node tools/devserver.mjs                              # local site at http://localhost:8787 (fake sign-in)
```

`tools/devserver.mjs` stands in for Supabase (database calls, engine loop, fake sign-in and a fake translator). Keep `site/lib/engine.js` identical to `supabase/functions/_shared/engine.js`.

## Files

- `site/` – the website (no build step). `app.js` routes; `views/` holds screens; `lib/engine.js` is shared game logic; `lib/pd.js` and `worker/strategy-worker.js` run strategies in a sandbox.
- `supabase/migrations/` – database schema, security rules and server functions.
- `supabase/functions/engine` – round resolution; `_shared/engine.js` is the pure game engine.
- `supabase/functions/translate-strategy` – Gemini strategy translator.
- `tests/` – unit and integration tests.

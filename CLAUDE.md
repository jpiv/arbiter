# Arbiter — working guide for Claude

## Golden rule: every change goes in a worktree

**Every single new change — no exceptions — must be built in a git worktree, not
directly in the main checkout.** This includes features, bug fixes, refactors,
CSS tweaks, copy edits, and one-line changes. If you're about to edit a file in
`/Users/john.pizzo/random/arbiter` directly, stop and create a worktree first.

Use the **`worktree` skill** (`/worktree`) for the full workflow. The short
version:

1. **Create** a worktree off `main` for the change
   (`/Users/john.pizzo/random/arbiter-worktrees/<feature>`), using a short
   kebab-case name.
2. **Build and test** the change inside that worktree (`npm install`, copy
   `.env`, then run it on its own port pair).
3. **Merge** the branch back into `main` when it's complete.
4. **Always clean up** — remove the worktree, delete the branch, and prune —
   immediately after the merge, every time.
5. **Confirm** to the user that the change is back in `main`.

The only work that may happen directly in the main checkout is the bookkeeping
the worktree workflow itself requires (e.g. committing pre-existing uncommitted
work before branching, or performing the merge-back and cleanup).

See `.claude/skills/worktree/SKILL.md` for the exact commands, conflict handling,
and conventions.

## Project basics

- Phaser 4 + Vite + TypeScript game with a small Express/OpenRouter API server.
  Client lives in `src/` (`src/game/` holds the Phaser scene and world); the API
  server is `server/openrouter.ts`.
- **Has npm dependencies and a build step.** Run `npm install` before anything
  else (a fresh worktree starts without `node_modules`).
- Run with `npm run dev` — it starts **two** processes: the Vite client
  (`http://localhost:5173`) and the Express/OpenRouter API server (`8787`)
  together. The client proxies `/api` → `8787` (hardcoded in `vite.config.ts`).
  The main checkout uses that port pair; give each concurrently-running worktree
  its own pair.
- Requires a gitignored `.env` at the repo root with `OPENROUTER_API_KEY`,
  `OPENROUTER_MODEL`, and `PORT` — the API server returns a 500 without the first
  two. Copy `.env` into each worktree (it isn't carried over by `git worktree add`).
- Typecheck / build with `npm run typecheck` and `npm run build` (both run `tsc`).
- Don't push to a remote unless the user explicitly asks.

## Game actions: everything goes through the single action interface

All gameplay actions live behind one interface in `src/game/actions/`, built so an
LLM can drive the game via tool calls. **Any new action an agent or player can
take (attack, move, build, …) must be added as a `GameAction` and registered
there** — never scatter action logic across the scene or input handlers.

The layering (see `src/game/actions/`):

```
LLM tools → GameToolset (wrapper) → GameInterface (single door) → action defs → GameContext → GameScene
```

- `GameAction` (`types.ts`) — a self-describing action: `name`, `description`,
  JSON-schema `parameters`, and `execute(args, ctx) → ActionResult`.
- `GameContext` (`types.ts`) — the Phaser-agnostic bridge to live game state,
  implemented by `GameScene`. Actions inspect/mutate the world only through it.
- `GameInterface` (`GameInterface.ts`) — the single registry + `invoke(name, args)`
  dispatcher. Every action flows through here; nothing calls action logic directly.
- `GameToolset` (`GameToolset.ts`) — wraps the interface as LLM tool specs
  (`specs()`) and a tool-call handler (`call()`).

To add an action:

1. Define a `GameAction` (usually its own file under `src/game/actions/`), with
   an LLM-readable `description` and `parameters`, and return a descriptive
   `ActionResult` on both success and failure.
2. Add any lookup/mutation it needs to `GameContext` and implement it on `GameScene`.
3. Register it in `ALL_ACTIONS` (`GameInterface.ts`) — it then becomes an LLM tool
   automatically via `GameToolset`.
4. Invoke it only through `GameInterface.invoke(...)`, and route the equivalent
   human input (clicks, keys) through the same call so input and LLM tools share
   one path.

**Conform to this pattern unless the feature is explicitly a user-only
interaction** an agent would never invoke — e.g. camera pan, selection
highlighting, HUD toggles. Those may live directly in the scene/input layer.

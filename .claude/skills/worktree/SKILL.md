---
name: worktree
description: Create, run, list, and remove git worktrees for the Arbiter game so multiple features can be built in parallel without disturbing the main checkout. Use when asked to "create/spin up a worktree", "work on X in parallel", "set up a branch to build Y", "give me the run command for this worktree", clean up/remove worktrees, or /worktree.
---

# Worktree — parallel feature development for Arbiter

`arbiter` is a Phaser 4 + Vite + TypeScript game with a small Express/OpenRouter
API server. Unlike a static site, a fresh worktree has **npm dependencies to
install** and a **gitignored `.env`** to copy before it can run. Budget for both
when creating one.

## Layout (fixed)

- **Main repo:**     `/Users/john.pizzo/random/arbiter`
- **Worktrees:**     `/Users/john.pizzo/random/arbiter-worktrees/<feature>`

Worktrees live in a **sibling** directory, never nested inside the repo. The
`.claude/skills/` dir is committed, so this skill is automatically available
inside every worktree too.

## Create a worktree

Use a short kebab-case feature name (e.g. `fog-of-war`, `unit-pathing`, `audio`).

```bash
REPO=/Users/john.pizzo/random/arbiter
WT=/Users/john.pizzo/random/arbiter-worktrees
FEATURE=<feature>                     # kebab-case; dir and branch share this name

# Commit any uncommitted work in the main checkout FIRST. A worktree branches
# off the `main` ref (last commit), not the working tree — uncommitted changes
# would otherwise be left behind and missing from the new worktree.
if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
  git -C "$REPO" add -A
  git -C "$REPO" commit -m "WIP: save main checkout before creating $FEATURE worktree"
fi

# Branch off the latest main into a new worktree
git -C "$REPO" worktree add "$WT/$FEATURE" -b "$FEATURE" main

# Install deps and copy the gitignored .env (node_modules and .env are NOT
# carried over by git worktree — the new checkout starts without either).
( cd "$WT/$FEATURE" && npm install )
[ -f "$REPO/.env" ] && cp "$REPO/.env" "$WT/$FEATURE/.env"
```

If the branch already exists, omit `-b`:

```bash
git -C "$REPO" worktree add "$WT/$FEATURE" "$FEATURE"
```

## Run the worktree's copy

`npm run dev` starts **two** processes: the Vite client (default `5173`) and the
Express/OpenRouter API server (default `8787`, from `PORT`). The main checkout
uses that pair; give each concurrently-running worktree its own pair (`5174` +
`8788`, `5175` + `8789`, …). Launch with the Bash tool's `run_in_background: true`
so it survives across turns, then tell the user the client URL.

`vite.config.ts` hardcodes the proxy target to `http://localhost:8787`, so a
worktree's client only reaches **its own** API server if that server is on 8787.
Two options:

- **Simplest — run one worktree at a time.** Stop the main checkout's servers,
  then `cd` into the worktree and run `npm run dev` unchanged (client `5173`,
  API `8787`). No port juggling, proxy already matches.

  ```bash
  cd /Users/john.pizzo/random/arbiter-worktrees/<feature>
  npm run dev
  # open http://localhost:5173
  ```

- **Truly parallel with the main checkout.** Give the worktree a fresh port pair
  and point its proxy at the worktree's own API port. Edit `server.proxy['/api']`
  in the worktree's `vite.config.ts` to `http://localhost:8788` (this edit stays
  local to the worktree — do **not** commit or merge it back), then:

  ```bash
  cd /Users/john.pizzo/random/arbiter-worktrees/<feature>
  PORT=8788 npm run dev:server &        # API on 8788
  npm run dev:client -- --port 5174     # client on 5174
  # open http://localhost:5174
  ```

## List / inspect

```bash
git -C /Users/john.pizzo/random/arbiter worktree list
```

## Finish up — merge back & remove

When a feature is complete, **merge its branch back into the main repo, then
always clean up the worktree** — every time, in the same step, without waiting
to be asked. A merged feature must never leave a worktree or branch behind:
removing the worktree (step 5) and pruning is a mandatory part of finishing, not
an optional follow-up. The only exception is an *incomplete* merge (unresolved
conflicts or an in-progress merge you're waiting on) — in that case pause and
leave the worktree in place until the merge can complete.

```bash
REPO=/Users/john.pizzo/random/arbiter
WT=/Users/john.pizzo/random/arbiter-worktrees
FEATURE=<feature>

# 1. Commit any leftover changes in the worktree
if [ -n "$(git -C "$WT/$FEATURE" status --porcelain)" ]; then
  git -C "$WT/$FEATURE" add -A
  git -C "$WT/$FEATURE" commit -m "<describe the completed feature>"
fi

# 2. Before merging, make sure the main repo isn't mid-merge already. A leftover
#    MERGE_HEAD means an earlier merge was started but never finished — do NOT
#    start a new one on top of it.
if git -C "$REPO" rev-parse -q --verify MERGE_HEAD >/dev/null; then
  echo "Main repo has an unfinished merge in progress."
fi
#    If that check reports an in-progress merge: pause. Poll periodically and wait
#    until it clears on its own (MERGE_HEAD gone and the tree is clean), and only
#    then continue. If it doesn't clear, tell the user and wait for them to say the
#    merge is complete before proceeding — never abort or force past their merge.

# 3. Merge the feature branch back into main
git -C "$REPO" checkout main
git -C "$REPO" merge "$FEATURE"
#    If git reports merge conflicts, resolve them yourself: open each conflicted
#    file, reconcile the two sides into a coherent result (don't blindly pick one
#    side or leave conflict markers behind), `git -C "$REPO" add` the resolved
#    files, then `git -C "$REPO" commit --no-edit` to complete the merge.

# 4. After resolving, re-check the tree — if there are new uncommitted changes
#    again, commit them before continuing.
if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
  git -C "$REPO" add -A
  git -C "$REPO" commit -m "Resolve merge conflicts for $FEATURE"
fi

# 5. Always clean up: remove the now-merged worktree and delete its branch.
#    This step is mandatory after a successful merge — never skip it.
git -C "$REPO" worktree remove "$WT/$FEATURE"
git -C "$REPO" branch -d "$FEATURE"    # -d only succeeds once merged; use -D to force-delete an abandoned branch
git -C "$REPO" worktree prune          # clean up stale metadata
```

### Always confirm the merge-back to the user

Once the merge is complete and the worktree is removed, **always output a
message confirming the feature/change is back in `main`.** State it plainly,
e.g. "✅ `<feature>` is merged back into main and the worktree is removed." If
the merge is *not* complete for any reason (conflicts left unresolved, an
in-progress merge you're waiting on, the feature was abandoned), say that
instead — never imply it landed on `main` when it didn't.

To **abandon** a feature instead of merging, skip steps 1–4 and force-remove:
`git -C "$REPO" worktree remove --force "$WT/$FEATURE"` then `git -C "$REPO" branch -D "$FEATURE"`.

## Conventions

- One worktree per feature; the directory and branch share the same kebab-case name.
- Always branch off `main`.
- Commit uncommitted work in the main checkout before creating a worktree.
- Never create a worktree inside the repo directory.
- A fresh worktree needs `npm install` and a copy of the gitignored `.env` before it can run — neither is carried over by `git worktree add`.
- Each concurrently running worktree gets its own port pair (client + API); the proxy edit in `vite.config.ts` stays local to the worktree and is never committed or merged back.
- When a feature is complete, merge its branch back into `main` before removing the worktree; resolve any merge conflicts yourself and commit, then commit again if resolving left new uncommitted changes.
- Always clean up the worktree (remove it, delete the branch, prune) immediately after a successful merge to `main` — every time, automatically, without being asked. A merged feature never leaves a worktree or branch behind.
- If the main repo already has an unfinished merge in progress (leftover `MERGE_HEAD`) when it's time to merge back, do not start a new merge — wait for that merge to complete (poll until it clears, or pause and ask the user to confirm it's done) before proceeding.
- Always end a merge-back by telling the user the feature/change is back in `main` (or, if it isn't, exactly why not). Never leave the outcome implicit.
- Don't push to a remote unless the user explicitly asks.

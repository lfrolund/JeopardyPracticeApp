# Jeopardy! Practice

A static web app for practicing Jeopardy!, built to run on GitHub Pages with no backend.

## Modes

**Unlimited.** Play clues one after another and keep a running score. You can choose:
- *Truly random clues*, or *random categories*: each category's clues are played together, either in random order or from lowest value up.
- Which rounds to draw from (Jeopardy!, Double Jeopardy!, Final Jeopardy!).

**Practice board.** A full 6 × 5 board for either the Jeopardy! round ($200 to $1,000) or Double Jeopardy! ($400 to $2,000). The Board setting picks either a real episode's six categories, or a mix of six categories drawn from ten random episodes (one per episode where possible). Daily Doubles follow the show's odds: one in the first round, two in Double Jeopardy! (never in the same category), with rows and columns weighted by where Daily Doubles actually landed in every episode of the dataset. You wager on them under the real limit: up to your score, or the round's top value if that's higher. Finished boards record your score and your [Coryat score](https://j-archive.com/help.php#coryatscore) so you can track progress.

**Three players.** Set Players to 3 and name everyone. When a clue opens, pick who rang in, then mark them right or wrong. After a miss, the others can try, or choose "No one". Ringing in happens off-screen, between the players. A correct response gives that player control (shown with a gold border). On a Daily Double, you confirm who picked it, and only that player wagers and answers. Each player keeps their own score, and the final standings are saved to history.

For every clue you can type a response (optional), reveal the correct one, and mark yourself right, wrong, or skip. The app suggests whether your typed response matches, but you make the call. Keyboard: Enter reveals, then R, W or S.

**Seasons.** Settings lets you limit clues to any set of seasons. All seasons are used by default. Clue values from before November 26, 2001, when the show doubled its values, are shown at today's values.

## Where the clues come from

Clues come from the [Jeopardy! clue dataset](https://github.com/jwolle1/jeopardy_clue_dataset) (seasons 1 to 42), read straight from GitHub. The app never downloads whole seasons. `data/index.json` records the byte range of each episode inside its season file at a pinned commit. To play an episode, the app makes one HTTP range request for it, which is about 8 KB. A practice board is one request. Unlimited mode fetches a batch of ten random episodes in the background so the next clue is ready, and keeps the last 80 episodes in memory.

The index holds offsets, counts and Daily Double statistics, and no clue text. `scripts/build-index.mjs` builds it, and the **Update episode index** workflow rebuilds it weekly when the dataset changes. Because the index pins a commit, later changes to the dataset can't break the byte ranges.

The dataset's author asks that it not be used in public-facing products. This repository doesn't copy or host any clues, but the deployed site is public. Keep that in mind before sharing the link.

A **Cluebase API** option remains in Settings for anyone running their own [Cluebase](https://github.com/lukelavin/cluebase). The public instance at `cluebase.lukelav.in` no longer resolves as of October 2026.

## Running locally

```sh
npm start      # serves the app at http://localhost:8000
npm test       # unit tests (Node 20+)
node scripts/build-index.mjs   # rebuild data/index.json against the dataset's latest commit
```

## Deploying

`.github/workflows/pages.yml` runs the tests and publishes the site on every push to `main`. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions** once.

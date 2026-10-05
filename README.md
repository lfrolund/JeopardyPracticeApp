# Jeopardy! Practice

A static web app for practicing Jeopardy!, built to run on GitHub Pages with no backend.

## Modes

**Unlimited.** Play clues one after another and keep a running score. You can choose:
- *Truly random clues*, or *random categories*: each category's clues are played together, either in random order or from lowest value up.
- Which rounds to draw from (Jeopardy!, Double Jeopardy!, Final Jeopardy!).

**Practice board.** A full 6 × 5 board for either the Jeopardy! round ($200 to $1,000) or Double Jeopardy! ($400 to $2,000). When possible, the board is a real episode's six categories. Daily Doubles follow the show's odds: one in the first round, two in Double Jeopardy! (never in the same category), with rows and columns weighted by where Daily Doubles actually landed in seasons 1 to 42. You wager on them under the real limit: up to your score, or the round's top value if that's higher. Finished boards record your score and your [Coryat score](https://j-archive.com/help.php#coryatscore) so you can track progress.

For every clue you can type a response (optional), reveal the correct one, and mark yourself right, wrong, or skip. The app suggests whether your typed response matches, but you make the call. Keyboard: Enter reveals, then R, W or S.

**Seasons.** Settings lets you limit clues to any set of seasons. All seasons are used by default. Clue values from before November 26, 2001, when the show doubled its values, are shown at today's values.

## Clue sources

- **Cluebase API.** The app uses [Cluebase](https://github.com/lukelavin/cluebase) at the URL you set in Settings. The public instance at `cluebase.lukelav.in` no longer resolves (as of October 2026), so you'll need a self-hosted copy that allows cross-origin requests.
- **Imported dataset.** Download the TSV files from the [Jeopardy! clue dataset](https://github.com/jwolle1/jeopardy_clue_dataset/releases) (the combined file or individual seasons) and load them in Settings. The files are parsed in your browser and stored in IndexedDB. Nothing is uploaded. When a dataset is imported, Daily Double odds are measured from its games instead of the built-in defaults.

The dataset's author asks that it not be used in public-facing products, so this repository doesn't bundle or host any clues. Each user loads their own copy.

## Running locally

```sh
npm start      # serves the app at http://localhost:8000
npm test       # unit tests (Node 20+)
```

## Deploying

`.github/workflows/pages.yml` runs the tests and publishes the site on every push to `main`. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions** once.

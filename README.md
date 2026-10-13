# Dicta

A minimal law vocabulary study website built with plain HTML, CSS, and JavaScript. It runs on GitHub Pages without a build step, account, or server-side application.

## Navigation and content

Home contains four clickable subjects: Legal Skills, Public Law, Civil Law, and Tort Law. The last three open a Coming soon page. The introductory saying is shown only on the first visit in a browser; existing progress also identifies a returning user.

Legal Skills opens directly to **Latin and Law French Terms** and these three collections:

| Collection | Terms |
| --- | ---: |
| Foundations and interpretation | 21 |
| Courts and procedure | 13 |
| Criminal, civil and property law | 17 |

All **51 terms** are included exactly once: **46 Latin and five Law French**. The term IDs, spellings, languages, university definitions, explanations, examples, and memory notes are preserved from the uploaded dataset. Only collection grouping changed; original topics are retained to select related quiz distractors.

Choose a collection, then Learn, Flashcards, or Quiz. There is no Continue Learning panel or Study Your Way menu on the module screen.

- Learn shows the definition immediately, with an optional memory note and uninterrupted Previous/Next navigation. There are no periodic recall prompts.
- Flashcards reveal the answer before self-rating. Forgotten cards return at most twice per session; reviewed and remembered counts are separate.
- Quiz gives immediate feedback and a retry path. Mastery requires two correct quiz answers in a row. Reading, card flips, self-ratings, and immediate practice retries do not count as mastery.
- Rare, explicitly fictional Mr Meyirbek encouragement remains limited to Legal Skills feedback and earned recall milestones.

## Add Dicta to a phone

Home has a collapsed **Add Dicta to your phone** guide.

**iPhone Safari:** Share → Add to Home Screen → keep Open as Web App enabled if shown → Add.

**Android Chrome:** browser menu → Install app or Add to Home screen.

Launch Dicta from the new Home Screen icon to use a separate window. The site includes a relative web app manifest with `display: standalone`, app icons, and iOS metadata. The guide is hidden when already running as a standalone app. This does not add offline support.

## Progress and privacy

Progress stays in localStorage on this browser/device, with no account or synchronization. Clearing browser data can erase it. The footer states “Your study progress is saved on this device.” Saved term progress from the original nine-collection release is preserved and migrated to the new grouping. Obsolete periodic-recall queues are discarded. Old numeric collection milestones are kept separate from new collection IDs.

The first-visit marker uses `dicta.welcome.v1`, separate from `dicta.progress.v1`. If browser storage is blocked, study still works and a warning appears; the greeting is shown at most once during that page visit. Live flashcard/quiz sessions restart on reload, while recorded progress survives.

## Preview and deploy

From the repository folder:

```sh
python3 -m http.server 8000
```

Open `localhost:8000`. Serve the complete folder over HTTP; opening an individual HTML file does not load its modules and dataset correctly.

Push the files to `ashyorq/Dicta` on `main`. In GitHub **Settings → Pages**, choose **Deploy from a branch → main → / (root) → Save**. The normal site URL is `https://ashyorq.github.io/Dicta/`.

Keep `index.html`, `app.js`, `styles.css`, `progress.mjs`, `study.mjs`, `view.mjs`, `dicta_terms.json`, `manifest.webmanifest`, `favicon.svg`, `icons/`, and `.nojekyll` in the repository root. Asset, icon, manifest, start, and scope URLs are relative, supporting both `/Dicta/` and a custom-domain root. GitHub Pages deployment is separate from publishing the cloud development environment.

## Verification

Logic and dataset tests require Node 18 or newer:

```sh
node --test tests/study.test.mjs
```

The 13 tests cover all 51 terms and their preserved educational content, meaningful quiz choices, finite repeats, honest progress, old-state migration, milestones, and first-visit persistence.

Optional browser tests require Python and Playwright:

```sh
python3 -m pip install playwright
python3 -m playwright install chromium webkit
```

Start a server from the checkout’s parent, then run:

```sh
python3 tests/browser_test.py --base-url http://127.0.0.1:8000/Dicta/
python3 tests/browser_test.py --base-url http://127.0.0.1:8000/Dicta/ --browser webkit
```

Browser coverage includes simplified navigation, all subjects, first/returning visits, install metadata, all 51 Learn entries, two complete quiz rounds, smooth navigation/flashcard/retry flows, migration, storage recovery, keyboard operation, and layouts at 320–1440px. The same suite can target the deployed HTTPS URL. Save screenshots with `--screenshots /tmp/dicta-screenshots`.

Study updates keep existing controls in place. New screens and terms scroll smoothly, respecting reduced-motion preferences; revealing answers and displaying feedback preserve the viewport. Browser history does not trigger competing automatic scrolls.

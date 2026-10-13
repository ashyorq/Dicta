# dicta.

Dicta 1.0 is a minimal, mobile-first legal vocabulary study website built with plain HTML, CSS, and JavaScript. It runs on GitHub Pages without a build, account, server-side application, or runtime dependencies. All assets and data are local; there are no external fonts, analytics, or services.

Legal Skills contains **Latin and Law French Terms**: exactly **51 terms in nine ordered collections**, comprising **46 Latin and five Law French** terms. Public Law, Civil Law, and Tort Law are marked “Coming soon”.

`dicta_terms.json` is the authoritative uploaded vocabulary dataset, preserved unchanged. University definitions are displayed verbatim; the dataset’s explanations, examples, and memory notes are supplementary study aids.

## Preview locally

From the repository folder:

```sh
python3 -m http.server 8000
```

Open `localhost:8000` in a browser. Serve the files over HTTP rather than opening `index.html` directly: the app loads its JSON dataset using `fetch` and uses JavaScript modules.

To check a GitHub Pages style repository subpath from this cloud workspace:

```sh
python3 -m http.server 8000 --directory /workspace
```

Open the `/Dicta/` path on that server. All asset URLs are relative, and screen navigation uses URL hashes, so refreshing a study screen does not require server routing rules.

For a physical iPhone on the same local network as your development computer, run the server with `--bind 0.0.0.0`, then open the computer’s local IP address and port 8000 in Safari. Use the deployed HTTPS site for the final iPhone check.

## Deploy through GitHub Pages

1. Commit the application files and push them to `ashyorq/Dicta` on `main`. Keep `index.html`, `styles.css`, `app.js`, `progress.mjs`, `study.mjs`, `dicta_terms.json`, `favicon.svg`, and `.nojekyll` in the repository root.
2. On GitHub, open the repository’s **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select **main** and **/ (root)**, then select **Save**.
5. Wait for the Pages deployment to finish. GitHub will show the published URL, normally `https://ashyorq.github.io/Dicta/`.

No Node installation, compilation, bundler, or custom GitHub Actions workflow is needed to publish. GitHub Pages publishes the contents of the selected branch. The cloud environment’s “Save and publish” action is separate and does not publish the website.

## Study behavior

- **Continue Learning** resumes the last viewed term and collection, or selects a short recall check when one is due.
- **Learn** shows the definition immediately, with language, explanation, and example. “Good to remember” expands the memory note. Previous/Next navigate the selected collection or the entire module. After five distinct viewed terms, an optional two-question recall check uses recent terms within the study scope.
- **Flashcards** show the term before the answer. Revealing alone does not count as reviewing. “Study again” repeats a card later, up to two revisits; even if every card is forgotten, the session ends. “I knew it” is a self-assessment. Unique reviewed and remembered cards are reported separately.
- **Quiz** uses four shuffled meanings from the dataset, with related distractors, immediate feedback, and incorrect-answer retry. Completed quizzes can be repeated, or missed terms can be practised separately.
- **Mastery** requires two correct quiz or short-recall answers in a row. A wrong answer resets that recall streak. Reading, revealing, flashcard self-ratings, and immediate/practice retries do not add mastery.
- Rare **Mr Meyirbek** messages appear only in Legal Skills feedback, after repeated flashcard struggle or demonstrated collection/module mastery. They are explicitly fictional app encouragement. The struggle and collection messages are limited to once per app visit; collection and whole-module milestones are also remembered across visits.

## Progress and privacy

Progress uses `localStorage` under `dicta.progress.v1`. It is specific to the browser and origin on this device, with no account or synchronization. A local preview and a deployed GitHub Pages site have separate progress. Clearing browser data can erase progress. Old, incomplete, invalid, or unavailable storage is handled defensively; studying still works when storage is blocked, with a visible warning.

Saved data includes the last viewed term and study scope, recent terms for recall, reading status, flashcard review/self-rating counts, quiz results, recall streaks, and previously reached encouragement milestones. A live flashcard or quiz session restarts if its page is reloaded; recorded progress survives. No personal data is transmitted.

## Verification

Run the dependency-free logic and dataset tests with Node 18 or newer:

```sh
node --test tests/study.test.mjs
```

The nine tests cover dataset completeness, related answer choices for every term, reading/review/recall separation, finite flashcard repeats, honest mastery, milestone frequency, and storage recovery.

The optional end-to-end test requires Python and Playwright, only for development:

```sh
python3 -m pip install playwright
python3 -m playwright install chromium webkit
```

With a server running from the parent of the checkout:

```sh
python3 tests/browser_test.py --base-url http://127.0.0.1:8000/Dicta/
python3 tests/browser_test.py --base-url http://127.0.0.1:8000/Dicta/ --browser webkit
```

The test uses a system Chromium if available, otherwise Playwright’s installed browser. It checks all 51 Learn entries and quiz questions, two full quiz rounds, recall/retry flows, finite flashcard sessions, encouragement milestones, keyboard reveal and skip navigation, reload/resume behavior, blocked/corrupt storage, relative asset loading, and layouts at 320–1440px. Optional screenshots can be saved with `--screenshots /tmp/dicta-screenshots`.

Current cloud validation: all nine Node tests and the Chromium end-to-end groups passed. WebKit could not be installed because its download hosts (`cdn.playwright.dev` and `playwright.download.prss.microsoft.com`) were blocked by the cloud network policy, so direct Safari/WebKit validation remains outstanding. The interface uses Safari-supported browser APIs, system fonts, native buttons and disclosures, visible keyboard focus, 44px-or-larger touch targets, and safe-area spacing. A final physical iPhone Safari check should cover Learn/recall, flashcard reveal/rating, quiz/retry, and progress after a reload.

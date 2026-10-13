"""End-to-end checks. Requires Playwright; the website itself has no dependencies.

Run against a static server, including a repository subpath:
  python tests/browser_test.py --base-url http://127.0.0.1:8000/Dicta/
  python tests/browser_test.py --base-url http://127.0.0.1:8000/Dicta/ --browser webkit
"""
import argparse
import json
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:8000/Dicta/')
parser.add_argument('--browser', choices=['chromium', 'webkit'], default='chromium')
parser.add_argument('--screenshots', type=Path)
args = parser.parse_args()
data = json.loads((Path(__file__).resolve().parents[1] / 'dicta_terms.json').read_text())
terms = {term['term']: term for term in data['terms']}
key = 'dicta.progress.v1'
checks = []

with sync_playwright() as playwright:
    options = {'headless': True}
    if args.browser == 'chromium' and shutil.which('chromium'):
        options.update(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    browser = getattr(playwright, args.browser).launch(**options)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = context.new_page()
    errors, bad_responses, external_requests = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: bad_responses.append(response.url) if response.status >= 400 else None)
    page.on('request', lambda request: external_requests.append(request.url) if not request.url.startswith(args.base_url) else None)

    def go(fragment='home'):
        page.goto(args.base_url + '#' + fragment)
        # A hash-only goto may reuse the current document. Reload explicitly
        # so direct-entry and saved-state checks exercise a fresh application.
        page.reload()
        expect(page.locator('main')).to_have_attribute('aria-busy', 'false')

    def clean():
        page.evaluate('(key) => localStorage.removeItem(key)', key)
        go()

    def saved():
        return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)

    def heading():
        return page.locator('h1').inner_text()

    def click_next():
        next_button = page.locator('[data-action="next-question"]')
        next_button.click()

    def screenshot(name):
        if args.screenshots:
            args.screenshots.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(args.screenshots / f'{args.browser}-{name}.png'), full_page=True)

    go()
    expect(page.get_by_role('link', name='Legal Skills Latin & Law French · 51 terms')).to_be_visible()
    assert page.locator('.subject').count() == 4
    assert page.locator('.subject.active').count() == 1
    assert 'Mr Meyirbek' not in page.locator('body').inner_text()
    screenshot('home')
    page.locator('.subject.active').click()
    assert page.locator('.collection-row').count() == 9
    assert page.locator('.collection-info h3').all_text_contents() == [item['title'] for item in data['collections']]
    screenshot('module')
    checks.append('Home, inactive subjects, and nine ordered collections')

    # Every term is reachable and renders the untouched authoritative fields.
    for collection in data['collections']:
        for term_id in collection['term_ids']:
            term = next(item for item in data['terms'] if item['id'] == term_id)
            go(f'learn/{collection["id"]}/{term_id}')
            expect(page.locator('h1')).to_have_text(term['term'])
            expect(page.locator('.definition')).to_have_text(term['university_definition'])
            expect(page.locator('.explanation p')).to_have_text(term['simple_explanation'])
            expect(page.locator('.example p')).to_have_text(term['legal_example'])
            assert term['language'] in page.locator('.term-meta').inner_text()
            assert not page.locator('details').evaluate('(el) => el.open')
            page.locator('summary').click()
            expect(page.locator('details p')).to_have_text(term['memory_note'])
    assert len(saved()['terms']) == 51
    assert all(term['streak'] == 0 and term['reviewed'] == 0 for term in saved()['terms'].values())
    checks.append('All 51 terms, definitions, examples, language labels, optional notes; no reading inflation')

    # Local storage and periodic recall stay within the selected collection.
    clean()
    go('learn/1/a-priori')
    for _ in range(4):
        page.get_by_role('link', name='Next', exact=True).click()
    expect(page.locator('h1')).to_have_text('Contra')
    expect(page.get_by_role('heading', name='A moment to recall?')).to_be_visible()
    screenshot('learn')
    page.get_by_role('link', name='Try 2 questions').click()
    for question in range(2):
        term = terms[heading()]
        assert term['id'] in data['collections'][0]['term_ids']
        correct = page.locator(f'[data-answer="{term["id"]}"]')
        if question == 0:
            page.locator(f'[data-answer]:not([data-answer="{term["id"]}"])').first.click()
            expect(page.get_by_role('heading', name='Not quite. Here’s the meaning.')).to_be_visible()
            page.get_by_role('button', name='Try again', exact=True).click()
            page.locator(f'[data-answer="{term["id"]}"]').click()
            assert saved()['terms'][term['id']]['streak'] == 0
        else:
            correct.click()
            assert saved()['terms'][term['id']]['streak'] == 1
        click_next()
    page.get_by_role('link', name='Continue learning').click()
    expect(page.locator('h1')).to_have_text('Contra')
    page.reload()
    expect(page.locator('h1')).to_have_text('Contra')
    go('legal-skills')
    page.get_by_role('link', name='Continue Learning').click()
    expect(page.locator('h1')).to_have_text('Contra')
    page.get_by_role('link', name='Previous', exact=True).click()
    expect(page.locator('h1')).to_have_text('Ante')
    page.evaluate('document.querySelector(".skip-link").click()')
    assert page.evaluate('document.activeElement.id') == 'main'
    assert heading() == 'Ante'
    # Selecting a new collection must not leave its recall checkpoint blocked
    # by an unanswered checkpoint from the previous scope.
    go('learn/1/a-priori')
    for _ in range(4):
        page.get_by_role('link', name='Next', exact=True).click()
    go('learn/2/de-facto')
    for _ in range(4):
        page.get_by_role('link', name='Next', exact=True).click()
    expect(page.get_by_role('heading', name='A moment to recall?')).to_be_visible()
    assert set(saved()['recent']) == set(data['collections'][1]['term_ids'])
    checks.append('Previous/Next, two-question recall, wrong-answer retry, reload, resume, and skip-link focus')

    # Keyboard-accessible flashcards repeat forgotten cards and end finitely.
    clean()
    go('flash/1')
    forgotten = terms[heading()]['id']
    assert not page.locator('.flash-answer').count()
    page.get_by_role('button', name='Reveal answer').focus()
    page.keyboard.press('Enter')
    assert page.locator('.flash-answer').count() == 1
    assert saved() is None, 'Simply revealing must not save a review'
    seen, struggle_messages = {}, 0
    while page.locator('.flash-card').count():
        term_id = terms[heading()]['id']
        seen[term_id] = seen.get(term_id, 0) + 1
        if page.get_by_role('button', name='Reveal answer').count():
            page.get_by_role('button', name='Reveal answer').click()
        page.get_by_role('button', name='Study again' if term_id == forgotten else 'I knew it', exact=True).click()
        if 'Mr Meyirbek still believes in you.' in page.locator('body').inner_text():
            struggle_messages += 1
            expect(page.get_by_text('Playful, fictional app encouragement', exact=False)).to_be_visible()
        page.locator('[data-action="next-flash"]').click()
    assert seen[forgotten] == 3
    assert len(seen) == 8
    assert sum(seen.values()) == 10
    assert struggle_messages == 1
    assert '8 cards reviewed · 7 remembered · 1 still to practise' in page.locator('.summary-card').inner_text()
    assert all(term['streak'] == 0 for term in saved()['terms'].values())
    screenshot('flash-summary')
    go()
    assert 'Mr Meyirbek' not in page.locator('body').inner_text()
    checks.append('Keyboard reveal, separate review/remember counts, finite repeats, and rare fictional struggle message')

    # Complete 102 real multiple-choice interactions instead of seeding mastery.
    clean()
    collection_messages, all_messages = 0, 0
    for run in range(2):
        go('quiz/all')
        asked = set()
        for question in range(51):
            term_id = terms[heading()]['id']
            assert term_id not in asked
            asked.add(term_id)
            assert page.locator('.choice').count() == 4
            page.locator(f'[data-answer="{term_id}"]').click()
            assert saved()['terms'][term_id]['streak'] == run + 1
            text = page.locator('body').inner_text()
            collection_messages += 'Mr Meyirbek would be proud.' in text
            all_messages += "You've earned Mr Meyirbek's approval." in text
            if question == 0:
                screenshot(f'quiz-round-{run + 1}')
            click_next()
        assert len(asked) == 51
        assert '51 of 51 correct on the first try.' in page.locator('.summary-card').inner_text()
    assert collection_messages == 1
    assert all_messages == 1
    progress = saved()
    assert all(term['streak'] == 2 for term in progress['terms'].values())
    assert len(progress['milestones']['collections']) == 9
    assert progress['milestones']['all'] is True
    go('legal-skills')
    assert '51 / 51 mastered' in page.locator('body').inner_text()
    page.reload()
    expect(page.get_by_text('51 / 51 mastered', exact=True)).to_be_visible()
    go('quiz/2')
    for _ in range(5):
        page.locator(f'[data-answer="{terms[heading()]["id"]}"]').click()
        assert 'Mr Meyirbek' not in page.locator('body').inner_text()
        click_next()
    checks.append('All 51 quiz terms twice, real mastery, collection/all milestones once, persisted recall progress')

    # Incorrect quiz completion and the finite practice-only retry flow.
    clean()
    go('quiz/4')
    missed_id = terms[heading()]['id']
    page.locator(f'[data-answer]:not([data-answer="{missed_id}"])').first.click()
    click_next()
    for _ in range(3):
        page.locator(f'[data-answer="{terms[heading()]["id"]}"]').click()
        click_next()
    page.get_by_role('button', name='Retry missed terms', exact=True).click()
    assert terms[heading()]['id'] == missed_id
    page.locator(f'[data-answer="{missed_id}"]').click()
    assert saved()['terms'][missed_id]['streak'] == 0
    click_next()
    expect(page.get_by_role('heading', name='Practice complete.', exact=True)).to_be_visible()
    checks.append('Quiz feedback, missed-term retry path, and practice-only correction progress')

    # Narrow mobile and desktop layouts, including the longest term.
    for width in [320, 375, 390, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 844})
        for fragment in ['home', 'legal-skills', 'collection/7', 'learn/all/novus-actus-interveniens', 'flash/all', 'quiz/all']:
            go(fragment)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}: {fragment}'
            assert page.locator('h1').count() == 1
    checks.append('320, 375, 390, 768, and 1440px layouts without horizontal overflow')

    # Corrupt/partial progress, and denied storage in a separate context.
    page.evaluate('(key) => localStorage.setItem(key, "{broken")', key)
    go('learn/1/a-priori')
    assert saved()['terms']['a-priori']['streak'] == 0
    page.evaluate('(key) => localStorage.setItem(key, JSON.stringify({terms: {"a-priori": {read: true, mastered: true}}, last: {id: "missing"}}))', key)
    go('legal-skills')
    assert '0 / 51 mastered' in page.locator('body').inner_text()
    blocked = browser.new_context(viewport={'width': 390, 'height': 844})
    blocked.add_init_script('Object.defineProperty(window, "localStorage", {get() {throw new Error("Storage denied")}})')
    blocked_page = blocked.new_page()
    blocked_page.goto(args.base_url + '#learn/1/a-priori')
    expect(blocked_page.locator('h1')).to_have_text('A priori')
    expect(blocked_page.locator('#storage-note')).to_contain_text('Progress cannot be saved')
    blocked.close()
    checks.append('Corrupt/old/incomplete progress and blocked localStorage')

    assert not errors, errors
    assert not bad_responses, bad_responses
    assert not external_requests, external_requests
    context.close()
    browser.close()

print(f'{args.browser}: {len(checks)} end-to-end groups passed')
for check in checks:
    print('  PASS ' + check)
print('  PASS no browser errors, failed asset requests, or external requests; repository subpath loads correctly')

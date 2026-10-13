"""End-to-end checks. Requires Playwright; the website itself has no dependencies.

Run against a static server, including a repository subpath:
  python tests/browser_test.py --base-url http://127.0.0.1:8000/Dicta/
  python tests/browser_test.py --base-url http://127.0.0.1:8000/Dicta/ --browser webkit
"""
import argparse
import json
import re
import shutil
import struct
from pathlib import Path
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:8000/Dicta/')
parser.add_argument('--browser', choices=['chromium', 'webkit'], default='chromium')
parser.add_argument('--screenshots', type=Path)
args = parser.parse_args()
data = json.loads((Path(__file__).resolve().parents[1] / 'dicta_terms.json').read_text())
terms = {term['term']: term for term in data['terms']}
by_id = {term['id']: term for term in data['terms']}
collections = data['collections']
term_count = len(by_id)
first, second = collections[:2]
key = 'dicta.progress.v1'
welcome_key = 'dicta.welcome.v1'
intro = re.compile(r'A little practice\.\s*A lasting understanding\.')
checks = []

assert len(data['terms']) == len(terms) == term_count == 51
assert [(item['id'], len(item['term_ids'])) for item in collections] == [
    ('foundations', 21), ('courts', 13), ('substantive', 17),
]
ordered_ids = [term_id for item in collections for term_id in item['term_ids']]
assert len(ordered_ids) == len(set(ordered_ids)) == term_count
assert set(ordered_ids) == set(by_id)
assert sum(term['language'] == 'Latin' for term in data['terms']) == 46
assert sum(term['language'] == 'Law French' for term in data['terms']) == 5

with sync_playwright() as playwright:
    options = {'headless': True}
    if args.browser == 'chromium' and shutil.which('chromium'):
        options.update(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    browser = getattr(playwright, args.browser).launch(**options)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = context.new_page()
    errors, bad_responses, external_requests = [], [], []

    def monitor(target):
        target.on('pageerror', lambda error: errors.append(str(error)))
        target.on('response', lambda response: bad_responses.append(response.url) if response.status >= 400 else None)
        target.on('request', lambda request: external_requests.append(request.url) if not request.url.startswith(args.base_url) else None)

    monitor(page)

    def ready(target=page):
        expect(target.locator('main')).to_have_attribute('aria-busy', 'false')

    def go(fragment='home'):
        page.goto(args.base_url + '#' + fragment)
        # Reload explicitly so direct-entry and saved-state checks exercise a
        # fresh application even when a hash-only goto reuses the document.
        page.reload()
        ready()

    def clean():
        page.evaluate('(key) => localStorage.removeItem(key)', key)
        go()

    def saved():
        return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)

    def heading():
        return page.locator('h1').inner_text()

    def click_next():
        page.locator('[data-action="next-question"]').click()

    def screenshot(name):
        if args.screenshots:
            args.screenshots.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(args.screenshots / f'{args.browser}-{name}.png'), full_page=True)

    # A first Home presentation consumes the welcome without creating progress.
    page.goto(args.base_url + '#home')
    ready()
    expect(page.locator('.wordmark')).to_have_text('Dicta')
    assert page.title().startswith('Dicta')
    assert len(intro.findall(page.locator('body').inner_text())) == 1
    assert page.evaluate('(key) => localStorage.getItem(key) !== null', welcome_key)
    assert saved() is None
    assert page.locator('.subject').count() == 4
    assert page.locator('a.subject').count() == 4
    assert 'Mr Meyirbek' not in page.locator('body').inner_text()
    for removed in ['Your study space', 'A quiet place to learn law', 'Make the language of law feel familiar',
                    'Start with Legal Skills', '01 / 04 available']:
        assert removed.lower() not in page.locator('body').inner_text().lower()
    install = page.locator('details.install-help')
    expect(install.locator('summary')).to_have_text('Add Dicta to your phone')
    assert not install.evaluate('(el) => el.open')
    install.locator('summary').click()
    instructions = install.inner_text().lower()
    for instruction in ['iphone', 'safari', 'share', 'add to home screen', 'open as web app', 'android', 'install app']:
        assert instruction in instructions
    install.locator('summary').click()
    screenshot('home-first-visit')

    for name, fragment in [('Public Law', 'public-law'), ('Civil Law', 'civil-law'), ('Tort Law', 'tort-law')]:
        page.locator(f'a.subject[href="#subject/{fragment}"]').click()
        expect(page.locator('h1')).to_have_text(name)
        expect(page.get_by_text('Coming soon', exact=True)).to_be_visible()
        page.locator('main a[href="#home"]').click()
        assert not intro.search(page.locator('body').inner_text())
    page.reload()
    ready()
    assert not intro.search(page.locator('body').inner_text())
    screenshot('home-returning')
    page.locator('a.subject[href="#legal-skills"]').click()
    expect(page.locator('h1')).to_have_text('Latin and Law French Terms')
    assert page.locator('.collection-row').count() == len(collections)
    assert page.locator('.collection-info :is(h2, h3)').all_text_contents() == [item['title'] for item in collections]
    assert not page.locator('.modes, .continue-card').count()
    assert 'Study Your Way' not in page.locator('main').inner_text()
    assert 'Continue Learning' not in page.locator('main').inner_text()
    # No intervening content block between the module title and its collections.
    assert page.locator('h1').evaluate('''el => {
        let container = el;
        while (container !== document.querySelector('main') && !container.nextElementSibling) container = container.parentElement;
        const next = container.nextElementSibling;
        return !!next && (next.matches('.collections') || !!next.querySelector('.collection-row'));
    }''')
    screenshot('module')
    for collection in collections:
        go(f'collection/{collection["id"]}')
        expect(page.locator('h1')).to_have_text(collection['title'])
        assert page.locator('.modes a').count() == 3
        assert [href.split('/')[0] for href in page.locator('.modes a').evaluate_all('(links) => links.map(link => link.getAttribute("href"))')] == ['#learn', '#flash', '#quiz']
        assert not page.locator('.term-list').count()
    checks.append('Minimal Dicta home/module, four accessible subjects, and exactly three content collections')

    # Direct module entry must not prematurely consume a first-visit Home intro.
    direct = browser.new_context(viewport={'width': 390, 'height': 844})
    direct_page = direct.new_page()
    monitor(direct_page)
    direct_page.goto(args.base_url + '#legal-skills')
    ready(direct_page)
    direct_page.locator('main a[href="#home"]').click()
    assert intro.search(direct_page.locator('body').inner_text())
    direct.close()
    returning = browser.new_context(viewport={'width': 390, 'height': 844})
    returning.add_init_script('localStorage.setItem("dicta.progress.v1", JSON.stringify({version: 1, terms: {}, last: null, recent: [], milestones: {collections: [], all: false}}))')
    returning_page = returning.new_page()
    monitor(returning_page)
    returning_page.goto(args.base_url + '#home')
    ready(returning_page)
    assert not intro.search(returning_page.locator('body').inner_text())
    returning.close()
    standalone = browser.new_context(viewport={'width': 390, 'height': 844})
    standalone.add_init_script('Object.defineProperty(navigator, "standalone", {get() {return true;}})')
    standalone_page = standalone.new_page()
    monitor(standalone_page)
    standalone_page.goto(args.base_url + '#home')
    ready(standalone_page)
    expect(standalone_page.locator('details.install-help')).to_be_hidden()
    standalone.close()
    checks.append('Welcome shown once, returning progress recognized, and phone instructions hidden in standalone mode')

    # Install metadata and all its relative assets work beneath /Dicta/.
    manifest_href = page.locator('link[rel="manifest"]').get_attribute('href')
    assert manifest_href and not manifest_href.startswith(('/', 'http:', 'https:'))
    manifest_response = page.request.get(urljoin(args.base_url, manifest_href))
    assert manifest_response.ok
    manifest = manifest_response.json()
    assert manifest['name'] == manifest['short_name'] == 'Dicta'
    assert manifest['display'] == 'standalone'
    assert urljoin(args.base_url, manifest['scope']) == args.base_url
    assert urljoin(args.base_url, manifest['start_url']).split('#')[0] == args.base_url
    icon_sizes = set()
    for icon in manifest['icons']:
        assert not icon['src'].startswith(('/', 'http:', 'https:'))
        response = page.request.get(urljoin(args.base_url, icon['src']))
        assert response.ok
        image = response.body()
        assert image[:8] == b'\x89PNG\r\n\x1a\n'
        width, height = struct.unpack('>II', image[16:24])
        assert icon['sizes'] == f'{width}x{height}'
        icon_sizes.add((width, height))
    assert {(192, 192), (512, 512)} <= icon_sizes
    expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).to_have_attribute('content', 'yes')
    expect(page.locator('meta[name="apple-mobile-web-app-title"]')).to_have_attribute('content', 'Dicta')
    apple_icon = page.locator('link[rel="apple-touch-icon"]').get_attribute('href')
    response = page.request.get(urljoin(args.base_url, apple_icon))
    assert response.ok and struct.unpack('>II', response.body()[16:24]) == (180, 180)
    checks.append('Relative standalone manifest and real 192/512/180px icons for GitHub Pages and phone windows')

    # Every term is reachable and renders all the authoritative fields.
    for collection in collections:
        for term_id in collection['term_ids']:
            term = by_id[term_id]
            go(f'learn/{collection["id"]}/{term_id}')
            expect(page.locator('h1')).to_have_text(term['term'])
            expect(page.locator('.definition')).to_have_text(term['university_definition'])
            expect(page.locator('.explanation p')).to_have_text(term['simple_explanation'])
            expect(page.locator('.example p')).to_have_text(term['legal_example'])
            assert term['language'] in page.locator('.term-meta').inner_text()
            assert not page.locator('main details').evaluate('(el) => el.open')
            page.locator('main summary').click()
            expect(page.locator('main details p')).to_have_text(term['memory_note'])
    assert len(saved()['terms']) == term_count
    assert all(term['streak'] == 0 and term['reviewed'] == 0 for term in saved()['terms'].values())
    checks.append('All 51 unique terms, 46 Latin/5 Law French, full definitions/examples/notes, and no reading inflation')

    # Local storage and periodic recall stay within the selected collection.
    clean()
    go(f'learn/{first["id"]}/{first["term_ids"][0]}')
    for _ in range(4):
        page.get_by_role('link', name='Next', exact=True).click()
    expect(page.locator('h1')).to_have_text(by_id[first['term_ids'][4]]['term'])
    expect(page.get_by_role('heading', name='A moment to recall?')).to_be_visible()
    screenshot('learn')
    page.get_by_role('link', name='Try 2 questions').click()
    for question in range(2):
        term = terms[heading()]
        assert term['id'] in first['term_ids']
        if question == 0:
            page.locator(f'[data-answer]:not([data-answer="{term["id"]}"])').first.click()
            expect(page.get_by_role('heading', name='Not quite. Here’s the meaning.')).to_be_visible()
            page.get_by_role('button', name='Try again', exact=True).click()
            page.locator(f'[data-answer="{term["id"]}"]').click()
            assert saved()['terms'][term['id']]['streak'] == 0
        else:
            page.locator(f'[data-answer="{term["id"]}"]').click()
            assert saved()['terms'][term['id']]['streak'] == 1
        click_next()
    page.get_by_role('link', name='Continue learning').click()
    expect(page.locator('h1')).to_have_text(by_id[first['term_ids'][4]]['term'])
    page.reload()
    ready()
    expect(page.locator('h1')).to_have_text(by_id[first['term_ids'][4]]['term'])
    page.get_by_role('link', name='Previous', exact=True).click()
    expect(page.locator('h1')).to_have_text(by_id[first['term_ids'][3]]['term'])
    page.evaluate('document.querySelector(".skip-link").click()')
    assert page.evaluate('document.activeElement.id') == 'main'
    go(f'learn/{first["id"]}/{first["term_ids"][0]}')
    for _ in range(4):
        page.get_by_role('link', name='Next', exact=True).click()
    go(f'learn/{second["id"]}/{second["term_ids"][0]}')
    for _ in range(4):
        page.get_by_role('link', name='Next', exact=True).click()
    expect(page.get_by_role('heading', name='A moment to recall?')).to_be_visible()
    assert set(saved()['recent']) == set(second['term_ids'][:5])
    checks.append('Previous/Next, collection-scoped short recall, wrong-answer retry, reload, and skip-link focus')

    # Keyboard-accessible flashcards repeat forgotten cards and end finitely.
    clean()
    go(f'flash/{first["id"]}')
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
    collection_size = len(first['term_ids'])
    assert seen[forgotten] == 3
    assert set(seen) == set(first['term_ids'])
    assert sum(seen.values()) == collection_size + 2
    assert struggle_messages == 1
    assert f'{collection_size} cards reviewed · {collection_size - 1} remembered · 1 still to practise' in page.locator('.summary-card').inner_text()
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
        for question in range(term_count):
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
        assert asked == set(by_id)
        assert f'{term_count} of {term_count} correct on the first try.' in page.locator('.summary-card').inner_text()
    assert collection_messages == all_messages == 1
    progress = saved()
    assert all(term['streak'] == 2 for term in progress['terms'].values())
    assert set(progress['milestones']['collections']) == {item['id'] for item in collections}
    assert progress['milestones']['all'] is True
    for collection in collections:
        go(f'collection/{collection["id"]}')
        assert f'{len(collection["term_ids"])} mastered' in page.locator('.module-meta').inner_text()
    page.reload()
    ready()
    assert f'{len(collections[-1]["term_ids"])} mastered' in page.locator('.module-meta').inner_text()
    go(f'quiz/{second["id"]}')
    for _ in range(5):
        page.locator(f'[data-answer="{terms[heading()]["id"]}"]').click()
        assert 'Mr Meyirbek' not in page.locator('body').inner_text()
        click_next()
    checks.append('All 51 quiz terms twice, real mastery, three collection/all milestones once, and persisted progress')

    # Incorrect quiz completion and the finite practice-only retry flow.
    clean()
    retry_collection = min(collections, key=lambda collection: len(collection['term_ids']))
    go(f'quiz/{retry_collection["id"]}')
    missed_id = terms[heading()]['id']
    page.locator(f'[data-answer]:not([data-answer="{missed_id}"])').first.click()
    click_next()
    for _ in range(len(retry_collection['term_ids']) - 1):
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
        for fragment in ['home', 'subject/public-law', 'legal-skills', f'collection/{first["id"]}',
                         'learn/all/novus-actus-interveniens', 'flash/all', 'quiz/all']:
            go(fragment)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}: {fragment}'
            assert page.locator('h1').count() == 1
            assert page.title().startswith('Dicta')
            assert not re.search(r'\bdicta\b', page.locator('body').inner_text())
    checks.append('320, 375, 390, 768, and 1440px layouts without horizontal overflow or lowercase branding')

    # Old numeric scope/milestones survive as per-term progress in new groups.
    legacy = {'version': 1, 'terms': {
        term_id: {'read': True, 'reviewed': 4, 'remembered': 3, 'correct': 3, 'missed': 1, 'streak': 2}
        for term_id in first['term_ids']
    }, 'last': {'id': first['term_ids'][0], 'scope': '1'}, 'recent': first['term_ids'][:2],
        'milestones': {'collections': ['1', '2', '4', '9'], 'all': False}}
    page.evaluate('([key, value]) => localStorage.setItem(key, JSON.stringify(value))', [key, legacy])
    go(f'collection/{first["id"]}')
    assert f'{len(first["term_ids"])} mastered' in page.locator('.module-meta').inner_text()
    # Learning persists the normalized state without incrementing recall scores.
    go(f'learn/{first["id"]}/{first["term_ids"][0]}')
    migrated = saved()
    assert migrated['terms'] == legacy['terms']
    assert migrated['last'] == {'id': first['term_ids'][0], 'scope': first['id']}
    assert set(migrated['recent']) == set(legacy['recent'])
    assert not migrated['milestones']['collections'], 'Small former milestones cannot imply mastery of broader collections'
    assert migrated['milestones']['all'] is False
    checks.append('Old numeric scopes migrate without losing per-term read/review/recall counters or granting broad milestones')

    # Corrupt/partial progress and denied storage in a separate context.
    page.evaluate('(key) => localStorage.setItem(key, "{broken")', key)
    go(f'learn/{first["id"]}/{first["term_ids"][0]}')
    assert saved()['terms'][first['term_ids'][0]]['streak'] == 0
    page.evaluate('(key) => localStorage.setItem(key, JSON.stringify({terms: {"a-priori": {read: true, mastered: true}}, last: {id: "missing"}}))', key)
    for collection in collections:
        go(f'collection/{collection["id"]}')
        assert '0 mastered' in page.locator('.module-meta').inner_text()
    blocked = browser.new_context(viewport={'width': 390, 'height': 844})
    blocked.add_init_script('Object.defineProperty(window, "localStorage", {get() {throw new Error("Storage denied")}})')
    blocked_page = blocked.new_page()
    monitor(blocked_page)
    blocked_page.goto(args.base_url + f'#learn/{first["id"]}/{first["term_ids"][0]}')
    expect(blocked_page.locator('h1')).to_have_text(by_id[first['term_ids'][0]]['term'])
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

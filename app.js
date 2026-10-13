import {
  loadProgress, saveProgress, markRead, markFlash, markRecall,
  isMastered, earnedEncouragement, consumeWelcome,
} from './progress.mjs?v=3';
import { validateDataset, shuffle, quizChoices, createFlashSession, rateFlash, flashSummary } from './study.mjs?v=3';
import { updateView, scrollToStart } from './view.mjs?v=3';

const main = document.querySelector('#main');
const storageNote = document.querySelector('#storage-note');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const plural = (number, noun) => `${number} ${noun}${number === 1 ? '' : 's'}`;
const diagonalArrow = '<svg class="arrow-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12" stroke="currentColor" stroke-width="1.5"/></svg>';
let data, byId, state, storage, flash, quiz;
let activeView = '', learnDone = false;
let activeScope = '', renderedHash = '';
let welcomeChecked = false;
const sessionMessages = new Set();
const otherSubjects = { 'public-law': 'Public Law', 'civil-law': 'Civil Law', 'tort-law': 'Tort Law' };

function persist() {
  if (!saveProgress(storage, state)) {
    storageNote.textContent = 'Progress cannot be saved in this browser. You can keep studying, but your progress may be lost when you leave.';
  }
}

function scopeIds(scope) {
  return scope === 'all' ? data.collections.flatMap(collection => collection.term_ids)
    : data.collections.find(collection => String(collection.id) === scope).term_ids;
}
const scopeTitle = scope => scope === 'all' ? 'Latin and Law French Terms'
  : data.collections.find(collection => String(collection.id) === scope).title;
const scopeBack = scope => scope === 'all' ? '#legal-skills' : `#collection/${scope}`;
const scopeName = scope => scope === 'all' ? 'Back to module' : 'Back to collection';
const back = (href, label) => `<a class="back" href="${href}"><span aria-hidden="true">←</span> ${escape(label)}</a>`;
const button = (label, action, secondary = false) => `<button class="button${secondary ? ' secondary' : ''}" type="button" data-action="${action}">${label}</button>`;
const linkButton = (label, href, secondary = false) => `<a class="button${secondary ? ' secondary' : ''}" href="${href}">${label}</a>`;
const encouragement = message => message ? `<aside class="encouragement" aria-label="Fictional app encouragement"><p>${escape(message)}</p><small>Playful, fictional app encouragement — not a quotation or a message from your teacher.</small></aside>` : '';
const masteredCount = ids => ids.filter(id => isMastered(state, id)).length;
const masteryNote = '<details class="progress-info"><summary>How progress works</summary><p>Mastery means two correct quiz answers in a row. Reading, flashcard self-ratings, and immediate retries do not add mastery.</p></details>';

function modeLinks(scope) {
  return `<nav class="modes" aria-label="Study modes">
    <a class="mode" href="#learn/${scope}/${scopeIds(scope)[0]}"><span class="mode-label">Learn ${diagonalArrow}</span></a>
    <a class="mode" href="#flash/${scope}"><span class="mode-label">Flashcards ${diagonalArrow}</span></a>
    <a class="mode" href="#quiz/${scope}"><span class="mode-label">Quiz ${diagonalArrow}</span></a>
  </nav>`;
}

function homeView() {
  const showWelcome = !welcomeChecked && consumeWelcome(storage);
  welcomeChecked = true;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return `<div class="home-content">
    ${showWelcome ? '<section class="welcome"><h1 tabindex="-1">A little practice.<br>A lasting understanding.</h1></section>' : '<h1 class="sr-only" tabindex="-1">Subjects</h1>'}
    <nav class="subject-grid" aria-label="Subjects">
      <a class="subject active" href="#legal-skills"><h2>Legal Skills</h2>${diagonalArrow}</a>
      ${Object.entries(otherSubjects).map(([id, name]) => `<a class="subject" href="#subject/${id}"><h2>${name}</h2>${diagonalArrow}</a>`).join('')}
    </nav>
    ${standalone ? '' : `<details class="install-help"><summary>Add Dicta to your phone</summary><div class="install-steps"><h2>iPhone · Safari</h2><ol><li>Open this website in Safari and tap <strong>Share</strong>.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Keep <strong>Open as Web App</strong> enabled if it appears, then tap <strong>Add</strong>.</li></ol><h2>Android · Chrome</h2><p>Open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p><p>Open Dicta from its new Home Screen icon to study in a separate window.</p></div></details>`}
  </div>`;
}

function moduleView() {
  return `<div class="reading-width">${back('#home', 'All subjects')}
    <h1 class="module-title" tabindex="-1">Latin and Law French Terms</h1>
    <ol class="collections">${data.collections.map(collection => `<li><a class="collection-row" href="#collection/${collection.id}"><div class="collection-info"><h2>${escape(collection.title)}</h2><p>${plural(collection.term_ids.length, 'term')}</p></div><span class="arrow" aria-hidden="true">→</span></a></li>`).join('')}</ol>
  </div>`;
}

function subjectView(id) {
  return `<div class="reading-width">${back('#home', 'All subjects')}<h1 tabindex="-1">${escape(otherSubjects[id])}</h1><p class="coming-soon">Coming soon</p></div>`;
}

function collectionView(scope) {
  const collection = data.collections.find(item => String(item.id) === scope);
  return `<div class="reading-width">${back('#legal-skills', 'All collections')}
    <h1 tabindex="-1">${escape(collection.title)}</h1><p class="module-meta">${plural(collection.term_ids.length, 'term')} · ${masteredCount(collection.term_ids)} mastered</p>
    ${modeLinks(scope)}${masteryNote}</div>`;
}

function definitionView(term) {
  return `<section class="definition-card"><h2 class="eyebrow">University definition</h2><p class="definition">${escape(term.university_definition)}</p></section>
    <section class="explanation"><h2>In plain language</h2><p>${escape(term.simple_explanation)}</p></section>
    <section class="example"><h2>In a legal context</h2><p>${escape(term.legal_example)}</p></section>
    <details><summary>Good to remember</summary><p>${escape(term.memory_note)}</p></details>`;
}

function learnView(scope, id) {
  const ids = scopeIds(scope), index = ids.indexOf(id), term = byId.get(id);
  if (learnDone) {
    return `<div class="reading-width">${back(scopeBack(scope), scopeName(scope))}<p class="eyebrow">Learn · ${escape(scopeTitle(scope))}</p>
      <h1 tabindex="-1">A little more familiar.</h1><div class="summary-card"><h2>You've reached the end.</h2><p>Reading is the first step. Try recalling the meanings to see what stays with you.</p><p class="small">Reading does not mark terms as mastered.</p></div>${modeLinks(scope)}${linkButton('Back to module', '#legal-skills', true)}</div>`;
  }
  markRead(state, id, scope);
  persist();
  return `<div class="reading-width">${back(scopeBack(scope), scopeName(scope))}
    <div class="study-heading"><p class="eyebrow">Learn</p><span>Term ${index + 1} of ${ids.length}</span></div><progress value="${index + 1}" max="${ids.length}" aria-label="Term position"></progress>
    <p class="term-meta">${escape(term.collection)} · ${escape(term.language)}</p><h1 class="term-name" tabindex="-1">${escape(term.term)}</h1>
    ${definitionView(term)}
    <nav class="study-nav" aria-label="Term navigation">${index ? linkButton('<span aria-hidden="true">←</span> Previous', `#learn/${scope}/${ids[index - 1]}`, true) : '<button class="button secondary" type="button" disabled>← Previous</button>'}
      ${index + 1 < ids.length ? linkButton('Next <span aria-hidden="true">→</span>', `#learn/${scope}/${ids[index + 1]}`) : button('Finish reading', 'finish-learn')}</nav>
    <p class="study-help">Definitions are from your university handout. Explanations, examples, and notes are supplementary study aids; check jurisdiction-specific details with your lecturer.</p></div>`;
}

function flashView(scope) {
  const info = flashSummary(flash);
  if (flash.position >= flash.queue.length) {
    return `<div class="reading-width">${back(scopeBack(scope), scopeName(scope))}<p class="eyebrow">Flashcards · Session complete</p><h1 tabindex="-1">Time to let it settle.</h1>
      <div class="summary-card"><h2>${info.remembered === info.reviewed ? 'A thoughtful review.' : 'Every revisit helps.'}</h2><p>${plural(info.reviewed, 'card')} reviewed · ${info.remembered} remembered · ${info.again} still to practise</p><p class="small">These are your final ratings for each card. Forgotten cards returned up to twice; the session is now complete. Self-assessments do not mark mastery.</p></div>
      <div class="actions">${button('Study again', 'restart-flash')}${linkButton('Back to module', '#legal-skills', true)}</div></div>`;
  }
  const id = flash.queue[flash.position], term = byId.get(id);
  const feedback = flash.feedback;
  return `<div class="reading-width">${back(scopeBack(scope), scopeName(scope))}<div class="study-heading"><p class="eyebrow">Flashcards</p><span>${info.reviewed} / ${flash.ids.length} reviewed</span></div>
    <progress value="${info.reviewed}" max="${flash.ids.length}" aria-label="Unique cards reviewed"></progress><p class="term-meta">${escape(scopeTitle(scope))} · ${escape(term.language)}${flash.attempts[id] ? ' · Revisit' : ''}</p>
    <div class="flash-card"><h1 class="term-name" tabindex="-1">${escape(term.term)}</h1>${flash.revealed ? `<section class="flash-answer"><h2 class="eyebrow">University definition</h2><p class="definition">${escape(term.university_definition)}</p><p>${escape(term.simple_explanation)}</p></section>` : '<p class="small">Bring its meaning to mind before revealing.</p>'}</div>
    ${!flash.revealed ? button('Reveal answer', 'reveal-flash').replace('class="button"', 'class="button reveal-button"') : ''}
    ${flash.revealed && !feedback ? `<div class="flash-controls">${button('Study again', 'flash-again', true)}${button('I knew it', 'flash-known')}</div><p class="study-help">Be honest with yourself. Flipping a card never counts as a review.</p>` : ''}
    ${feedback ? `<section class="feedback${feedback.remembered ? '' : ' incorrect'}" aria-live="polite" tabindex="-1" id="feedback"><h2>${feedback.remembered ? 'Remembered.' : 'A little more practice.'}</h2><p>${feedback.remembered ? 'A useful moment of recall. Keep going at your own pace.' : feedback.repeats ? 'This card will return later in this session.' : 'Keep this term in mind for your next study session.'}</p>${encouragement(feedback.message)}${button(flash.position + 1 >= flash.queue.length ? 'Finish session' : 'Next card →', 'next-flash')}</section>` : ''}
    <p class="study-help">${info.remembered} remembered · Forgotten cards return up to twice. Mastery is checked in Quiz.</p></div>`;
}

function createQuiz(scope, ids, practice = false) {
  return { scope, ids: shuffle(ids), practice, position: 0, choices: null, answer: null, retrying: false, firstCorrect: new Set(), missed: new Set(), corrected: new Set(), message: '' };
}

function quizView(scope) {
  if (quiz.position >= quiz.ids.length) {
    return `<div class="reading-width">${back(scopeBack(scope), scopeName(scope))}<p class="eyebrow">Quiz · Complete</p><h1 tabindex="-1">${quiz.firstCorrect.size === quiz.ids.length ? 'The meanings are taking shape.' : 'Practice makes it clearer.'}</h1>
      <div class="summary-card"><h2>${quiz.practice ? 'Practice complete.' : `${quiz.firstCorrect.size} of ${quiz.ids.length} correct on the first try.`}</h2><p>${quiz.corrected.size ? `${plural(quiz.corrected.size, 'answer')} corrected with practice. ` : ''}${quiz.missed.size ? 'Revisit the terms that felt less familiar.' : 'A little recall goes a long way.'}</p><p class="small">${quiz.practice ? 'Retries help you practise; they do not add mastery.' : 'Two correct quiz answers in a row demonstrate mastery. Reading or viewing a question does not.'}</p></div>
      <div class="actions">${button('Quiz again', 'restart-quiz')}${quiz.missed.size ? button('Retry missed terms', 'retry-missed', true) : ''}${linkButton('Back to module', '#legal-skills', true)}</div></div>`;
  }
  const id = quiz.ids[quiz.position], term = byId.get(id);
  quiz.choices ||= quizChoices(data, id);
  const correct = quiz.answer === id;
  return `<div class="reading-width quiz">${back(scopeBack(scope), scopeName(scope))}
    <div class="study-heading"><p class="eyebrow">Quiz${quiz.practice ? ' · Practice' : ''}</p><span>Question ${quiz.position + 1} of ${quiz.ids.length}</span></div><progress value="${quiz.position + 1}" max="${quiz.ids.length}" aria-label="Question position"></progress>
    <p class="term-meta">${escape(scopeTitle(scope))}${quiz.retrying ? ' · Try again' : ''}</p><p class="quiz-prompt">Which meaning belongs to this term?</p><h1 class="term-name" tabindex="-1">${escape(term.term)}</h1>
    <div class="choices" role="group" aria-label="Choose the meaning">${quiz.choices.map((choice, index) => {
      const result = quiz.answer ? choice.id === id ? ' correct' : choice.id === quiz.answer ? ' incorrect' : '' : '';
      return `<button type="button" class="choice${result}" data-answer="${choice.id}" ${quiz.answer ? 'disabled' : ''}><span class="choice-letter" aria-hidden="true">${String.fromCharCode(65 + index)}</span><span>${escape(choice.simple_explanation)}${result ? `<span class="choice-state">${result === ' correct' ? 'Correct meaning' : 'Your answer — try again'}</span>` : ''}</span></button>`;
    }).join('')}</div>
    ${quiz.answer ? `<section class="feedback${correct ? '' : ' incorrect'}" id="feedback" tabindex="-1" aria-live="polite"><h2>${correct ? quiz.retrying || quiz.practice ? 'Correct. A useful practice.' : 'Correct. Nicely recalled.' : 'Not quite. Here’s the meaning.'}</h2><p><strong>${escape(term.term)}:</strong> ${escape(term.university_definition)}</p><p>${escape(term.simple_explanation)}</p>${encouragement(quiz.message)}<div class="actions">${correct ? button(quiz.position + 1 === quiz.ids.length ? 'Finish' : 'Next question →', 'next-question') : `${button('Try again', 'retry-question')}${button(quiz.position + 1 === quiz.ids.length ? 'Finish' : 'Next question', 'next-question', true)}`}</div></section>` : '<p class="study-help">Take a moment to recall. Only your answer can add recall progress.</p>'}
    </div>`;
}

function routeParts() {
  const parts = location.hash.slice(1).split('/');
  const scope = parts[1] === 'all' || data.collections.some(item => String(item.id) === parts[1]) ? parts[1] : 'all';
  const requestedView = parts[0] || 'home';
  // Old recall bookmarks now open the collection instead of a recall check.
  const view = requestedView === 'recall' ? scope === 'all' ? 'legal-skills' : 'collection' : requestedView;
  const ids = scopeIds(scope);
  return { view, scope, id: ids.includes(parts[2]) ? parts[2] : ids[0] };
}

function render(focus = true) {
  const { view, scope, id } = routeParts();
  const preserve = view === activeView && scope === activeScope && ['learn', 'flash', 'quiz'].includes(view);
  let content;
  if (view === 'legal-skills') content = moduleView();
  else if (view === 'subject' && otherSubjects[location.hash.split('/')[1]]) content = subjectView(location.hash.split('/')[1]);
  else if (view === 'collection' && scope !== 'all') content = collectionView(scope);
  else if (view === 'learn') content = learnView(scope, id);
  else if (view === 'flash') {
    if (!flash || activeView !== view || flash.scope !== scope) flash = { ...createFlashSession(scopeIds(scope)), scope };
    content = flashView(scope);
  } else if (view === 'quiz') {
    if (!quiz || activeView !== view || quiz.scope !== scope) {
      quiz = createQuiz(scope, scopeIds(scope));
    }
    content = quizView(scope);
  } else content = homeView();
  activeView = view;
  activeScope = scope;
  renderedHash = location.hash;
  updateView(main, content, preserve);
  main.setAttribute('aria-busy', 'false');
  document.title = view === 'home' ? 'Dicta' : `Dicta — ${view === 'legal-skills' ? 'Legal Skills' : view === 'subject' ? otherSubjects[location.hash.split('/')[1]] || 'Subjects' : scopeTitle(scope)}`;
  if (focus) {
    main.querySelector('h1')?.focus({ preventScroll: true });
    scrollToStart();
  }
}

function focusFeedback() {
  document.querySelector('#feedback')?.focus({ preventScroll: true });
}

main.addEventListener('click', event => {
  const answer = event.target.closest('[data-answer]');
  if (answer && quiz && !quiz.answer && activeView === 'quiz') {
    const id = quiz.ids[quiz.position], selected = answer.dataset.answer;
    if (!quiz.choices.some(choice => choice.id === selected)) return;
    const correct = selected === id;
    quiz.answer = selected;
    markRecall(state, id, correct, quiz.practice || quiz.retrying);
    if (correct && !quiz.retrying) quiz.firstCorrect.add(id);
    if (correct && quiz.retrying) quiz.corrected.add(id);
    if (!correct) quiz.missed.add(id);
    quiz.message = correct ? earnedEncouragement(state, data, sessionMessages) : '';
    persist(); render(false); focusFeedback();
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const { scope } = routeParts();
  switch (action) {
    case 'finish-learn': learnDone = true; render(); break;
    case 'reveal-flash':
      flash.revealed = true; render(false); main.querySelector('[data-action="flash-again"]')?.focus({ preventScroll: true }); break;
    case 'flash-again':
    case 'flash-known': {
      const remembered = action === 'flash-known';
      const result = rateFlash(flash, remembered);
      if (!result) break;
      markFlash(state, result.id, remembered);
      if (!remembered && flash.forgotten[result.id] >= 2 && !sessionMessages.has('struggle')) {
        result.message = 'Mr Meyirbek still believes in you.';
        sessionMessages.add('struggle');
      }
      persist(); render(false); focusFeedback(); break;
    }
    case 'next-flash': flash.position++; flash.revealed = false; flash.feedback = null; render(); break;
    case 'restart-flash': flash = { ...createFlashSession(scopeIds(scope)), scope }; render(); break;
    case 'retry-question': quiz.retrying = true; quiz.answer = null; quiz.message = ''; quiz.choices = quizChoices(data, quiz.ids[quiz.position]); render(); break;
    case 'next-question': quiz.position++; quiz.answer = null; quiz.retrying = false; quiz.choices = null; quiz.message = ''; render(); break;
    case 'restart-quiz': quiz = createQuiz(scope, scopeIds(scope)); render(); break;
    case 'retry-missed': quiz = createQuiz(scope, [...quiz.missed], true); render(); break;
  }
});

document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: 'start' });
});

document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!data || !link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const hash = link.getAttribute('href');
  if (hash === location.hash) return;
  // History routing avoids Safari's native fragment scrolling racing our UI.
  history.pushState(null, '', hash);
  learnDone = false;
  render();
});

function restoreRoute() {
  if (data && location.hash !== renderedHash) { learnDone = false; render(); }
}
window.addEventListener('popstate', restoreRoute);
window.addEventListener('hashchange', restoreRoute);

async function initialise() {
  try {
    const response = await fetch('./dicta_terms.json?v=3');
    if (!response.ok) throw new Error(`Dataset request failed: ${response.status}`);
    data = validateDataset(await response.json());
    byId = new Map(data.terms.map(term => [term.id, term]));
    try { storage = window.localStorage; } catch { /* Some private browsing policies block storage. */ }
    const loaded = loadProgress(storage, data);
    state = loaded.state;
    if (!loaded.available) storageNote.textContent = 'Progress cannot be saved in this browser. You can keep studying, but your progress may be lost when you leave.';
    render(false);
  } catch (error) {
    main.setAttribute('aria-busy', 'false');
    main.innerHTML = '<h1 tabindex="-1">Dicta couldn’t open.</h1><p>The vocabulary file could not be loaded. Please serve the complete Dicta folder over HTTP or use its GitHub Pages site, then try again.</p><button class="button" id="reload" type="button">Try again</button>';
    document.querySelector('#reload').addEventListener('click', () => location.reload());
    console.error('Dicta could not initialise:', error);
  }
}

initialise();

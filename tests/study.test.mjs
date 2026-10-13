import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateDataset, quizChoices, createFlashSession, rateFlash, flashSummary } from '../study.mjs';
import { STORAGE_KEY, WELCOME_KEY, consumeWelcome, freshProgress, normaliseProgress, loadProgress, saveProgress, markRead, markFlash, markRecall, isMastered, earnedEncouragement } from '../progress.mjs';

const data = JSON.parse(await readFile(new URL('../dicta_terms.json', import.meta.url), 'utf8'));
const ids = data.collections.flatMap(collection => collection.term_ids);
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('authoritative dataset has exactly 51 unique terms, three content collections, and 46/5 languages', () => {
  assert.equal(validateDataset(data), data);
  assert.equal(ids.length, 51);
  assert.equal(new Set(ids).size, 51);
  assert.deepEqual(data.collections.map(item => [item.id, item.title, item.term_ids.length]), [
    ['foundations', 'Foundations and interpretation', 21],
    ['courts', 'Courts and procedure', 13],
    ['substantive', 'Criminal, civil and property law', 17],
  ]);
  assert.equal(data.metadata.collections, 3);
  assert.deepEqual(data.collections.map(collection => [...new Set(collection.term_ids.map(id => data.terms.find(term => term.id === id).topic))]), [
    ['Legal foundations', 'Law and reality', 'Legal interpretation', 'Other legal expressions'],
    ['Courts and precedent', 'Court procedures'],
    ['Criminal law', 'Civil law and tort', 'Contracts and property'],
  ]);
  assert.deepEqual(new Set(ids), new Set(data.terms.map(term => term.id)));
  assert.equal(data.terms.filter(term => term.language === 'Latin').length, 46);
  assert.equal(data.terms.filter(term => term.language === 'Law French').length, 5);
  assert.throws(() => validateDataset({ ...data, terms: data.terms.slice(1) }));
  assert.throws(() => validateDataset({ ...data, metadata: { ...data.metadata, collections: 9 } }));
});

test('all original term IDs, spelling, languages and educational content remain unchanged', () => {
  const fields = ['id', 'term', 'language', 'university_definition', 'simple_explanation', 'legal_example', 'memory_note'];
  const content = data.terms.map(term => Object.fromEntries(fields.map(field => [field, term[field]])));
  // Fingerprint of these fields in the original 51-term dataset, before regrouping.
  assert.equal(createHash('sha256').update(JSON.stringify(content)).digest('hex'), '458aa51813323a723e6a0cfdac90f98e12eda624bd7bd1983e3a0d02b1a47941');
});

test('all 51 quiz questions offer exactly one correct answer and varied, related dataset meanings', () => {
  for (const id of ids) {
    const combinations = new Set();
    for (let iteration = 0; iteration < 20; iteration++) {
      const choices = quizChoices(data, id);
      assert.equal(choices.length, 4);
      assert.equal(new Set(choices.map(term => term.id)).size, 4);
      assert.equal(new Set(choices.map(term => term.simple_explanation)).size, 4);
      assert.equal(choices.filter(term => term.id === id).length, 1);
      for (const choice of choices) assert.equal(choice, data.terms.find(term => term.id === choice.id));
      combinations.add(choices.map(term => term.id).join(','));
    }
    assert.ok(combinations.size > 1, `${id}: order must vary`);
  }
  const criminalChoices = quizChoices(data, 'mens-rea');
  assert.ok(criminalChoices.every(term => term.topic === 'Criminal law'));
  const interpretationChoices = quizChoices(data, 'noscitur-a-sociis');
  assert.ok(interpretationChoices.every(term => term.topic === 'Legal interpretation'));
  assert.ok(quizChoices(data, 'quantum').some(term => term.topic === 'Civil law and tort'), 'Original topics still provide close meanings within larger collections');
});

test('reading and flipping do not inflate reviews or mastery; flash recall is tracked separately', () => {
  const state = freshProgress();
  const session = createFlashSession(['a-priori']);
  markRead(state, 'a-priori', 'foundations');
  assert.equal(state.terms['a-priori'].read, true);
  assert.equal(state.terms['a-priori'].reviewed, 0);
  assert.equal(isMastered(state, 'a-priori'), false);
  assert.equal(rateFlash(session, true), null);
  session.revealed = true;
  assert.equal(flashSummary(session).reviewed, 0);
  const rating = rateFlash(session, true);
  markFlash(state, rating.id, true);
  assert.equal(state.terms['a-priori'].reviewed, 1);
  assert.equal(state.terms['a-priori'].remembered, 1);
  assert.equal(isMastered(state, 'a-priori'), false);
  assert.equal(rateFlash(session, true), null, 'Cannot rate the same card twice');
});

test('forgotten cards return later and even an all-forgotten 51-card session ends after 153 ratings', () => {
  const session = createFlashSession(ids);
  const initialOrder = [...session.queue];
  while (session.position < session.queue.length) {
    session.revealed = true;
    const result = rateFlash(session, false);
    assert.ok(result);
    session.position++;
    session.feedback = null;
    session.revealed = false;
    assert.ok(session.position <= 153);
  }
  assert.deepEqual(session.queue.slice(0, 51), initialOrder);
  assert.deepEqual(session.queue.slice(51, 102), initialOrder);
  assert.equal(session.ratings, 153);
  assert.deepEqual(flashSummary(session), { reviewed: 51, remembered: 0, again: 51 });
});

test('a remembered revisit replaces the final self-rating without counting a second unique card', () => {
  const session = createFlashSession(['a-priori']);
  session.revealed = true; rateFlash(session, false);
  session.position++; session.feedback = null; session.revealed = true;
  rateFlash(session, true);
  assert.deepEqual(flashSummary(session), { reviewed: 1, remembered: 1, again: 0 });
  assert.equal(session.queue.length, 2);
});

test('mastery requires two successful recall answers; a miss resets it and immediate retries do not restore it', () => {
  const state = freshProgress();
  markRecall(state, 'a-priori', true);
  assert.equal(isMastered(state, 'a-priori'), false);
  markRecall(state, 'a-priori', true);
  assert.equal(isMastered(state, 'a-priori'), true);
  markRecall(state, 'a-priori', false);
  assert.equal(isMastered(state, 'a-priori'), false);
  markRecall(state, 'a-priori', true, true);
  assert.equal(state.terms['a-priori'].streak, 0);
});

test('reading remembers the last view and offers recall after five distinct terms', () => {
  const state = freshProgress();
  for (const id of ids.slice(0, 5)) { markRead(state, id, 'foundations'); markRead(state, id, 'foundations'); }
  assert.equal(state.recent.length, 5);
  assert.deepEqual(state.last, { id: ids[4], scope: 'foundations' });
  assert.equal(masteredCount(state), 0);
  for (const id of data.collections[1].term_ids) markRead(state, id, 'courts');
  assert.deepEqual(state.recent, data.collections[1].term_ids.slice(0, 5), 'A new collection must not inherit another collection’s pending recall');
});

function masteredCount(state) { return ids.filter(id => isMastered(state, id)).length; }

test('milestone messages require complete recall mastery and are emitted once; collection text is rare within a session', () => {
  const state = freshProgress(), messages = new Set();
  for (const id of data.collections[0].term_ids) markRead(state, id, 'foundations');
  assert.equal(earnedEncouragement(state, data, messages), '');
  for (const id of data.collections[0].term_ids) { markRecall(state, id, true); markRecall(state, id, true); }
  assert.equal(earnedEncouragement(state, data, messages), 'Mr Meyirbek would be proud.');
  assert.equal(earnedEncouragement(state, data, messages), '');
  for (const id of data.collections[1].term_ids) { markRecall(state, id, true); markRecall(state, id, true); }
  assert.equal(earnedEncouragement(state, data, messages), '');
  for (const id of ids) { markRecall(state, id, true); markRecall(state, id, true); }
  assert.equal(earnedEncouragement(state, data, messages), "You've earned Mr Meyirbek's approval.");
  assert.equal(earnedEncouragement(state, data, new Set()), '');
});

test('progress survives serialization and incomplete, corrupt, future, and unavailable storage is safe', () => {
  const state = freshProgress(), local = storage();
  markRead(state, 'de-jure', 'foundations'); markRecall(state, 'de-jure', true); markFlash(state, 'de-jure', false);
  assert.equal(saveProgress(local, state), true);
  assert.deepEqual(loadProgress(local, data).state, state);
  local.setItem(STORAGE_KEY, '{ broken');
  assert.deepEqual(loadProgress(local, data).state, freshProgress());
  assert.deepEqual(normaliseProgress(null, data), freshProgress());
  assert.deepEqual(normaliseProgress({ version: 99 }, data), freshProgress());
  const partial = normaliseProgress({ terms: { 'de-jure': { read: true, mastered: true, reviewed: -4, remembered: 500, correct: 1, streak: 90 }, unknown: { read: true } }, last: { id: 'de-jure', scope: 'courts' }, recent: ['unknown', 'de-jure', 'de-jure'] }, data);
  assert.deepEqual(Object.keys(partial.terms), ['de-jure']);
  assert.deepEqual(partial.last, { id: 'de-jure', scope: 'all' });
  assert.deepEqual(partial.recent, ['de-jure']);
  assert.equal(partial.terms['de-jure'].reviewed, 0);
  assert.equal(partial.terms['de-jure'].remembered, 0);
  assert.equal(partial.terms['de-jure'].streak, 1);
  assert.equal(isMastered(partial, 'de-jure'), false);
  const blocked = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Quota'); } };
  assert.equal(loadProgress(blocked, data).available, false);
  assert.equal(saveProgress(blocked, state), false);
});

test('old numeric collection scopes migrate by term membership while v1 progress remains intact', () => {
  const examples = [
    ['a-priori', 1, 'foundations'], ['de-jure', '2', 'foundations'],
    ['dictum', 3, 'courts'], ['noscitur-a-sociis', '4', 'foundations'],
    ['mens-rea', 5, 'substantive'], ['quantum', '6', 'substantive'],
    ['chose', 7, 'substantive'], ['voir-dire', '8', 'courts'],
    ['pro-bono', 9, 'foundations'],
  ];
  for (const [id, scope, expected] of examples) {
    const term = { read: true, reviewed: 3, remembered: 2, correct: 4, missed: 1, streak: 2 };
    const migrated = normaliseProgress({ version: 1, terms: { [id]: term }, last: { id, scope }, recent: [id], milestones: { collections: [1, '2', 3, 'courts', 'unknown'], all: true } }, data);
    assert.deepEqual(migrated.terms[id], term);
    assert.deepEqual(migrated.last, { id, scope: expected });
    assert.deepEqual(migrated.recent, [id]);
    assert.deepEqual(migrated.milestones.collections, ['courts'], 'A small former collection milestone must not count for a broader replacement');
    assert.equal(migrated.milestones.all, true);
  }
  assert.deepEqual(normaliseProgress({ last: { id: 'de-jure', scope: 'all' } }, data).last, { id: 'de-jure', scope: 'all' });
  assert.deepEqual(normaliseProgress({ last: { id: 'de-jure', scope: '1' } }, data).last, { id: 'de-jure', scope: 'foundations' });
});

test('the first-visit greeting is consumed separately without creating or clearing progress', () => {
  const local = storage();
  assert.equal(consumeWelcome(local), true);
  assert.equal(local.getItem(WELCOME_KEY), 'shown');
  assert.equal(local.getItem(STORAGE_KEY), null);
  assert.equal(consumeWelcome(local), false);
  assert.equal(consumeWelcome(local), false, 'Returning Home or reloading must not repeat the greeting');

  const existing = storage();
  const progress = JSON.stringify({ ...freshProgress(), last: { id: 'de-jure', scope: '2' } });
  existing.setItem(STORAGE_KEY, progress);
  assert.equal(consumeWelcome(existing), false, 'People with older saved progress have already visited');
  assert.equal(existing.getItem(STORAGE_KEY), progress);
  assert.equal(existing.getItem(WELCOME_KEY), 'shown');
});

test('welcome consumption handles unavailable storage and read-only saved progress safely', () => {
  const blocked = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Quota'); } };
  assert.equal(consumeWelcome(blocked), true, 'The view keeps this result for the current page lifetime');
  assert.equal(consumeWelcome(undefined), true);
  const readOnly = { getItem: key => key === STORAGE_KEY ? '{}' : null, setItem() { throw new Error('Quota'); } };
  assert.equal(consumeWelcome(readOnly), false, 'A failed marker write must not turn an existing user into a new user');
});

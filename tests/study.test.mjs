import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDataset, quizChoices, createFlashSession, rateFlash, flashSummary } from '../study.mjs';
import { STORAGE_KEY, freshProgress, normaliseProgress, loadProgress, saveProgress, markRead, markFlash, markRecall, isMastered, earnedEncouragement } from '../progress.mjs';

const data = JSON.parse(await readFile(new URL('../dicta_terms.json', import.meta.url), 'utf8'));
const ids = data.collections.flatMap(collection => collection.term_ids);
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('authoritative dataset has exactly 51 unique terms, nine ordered collections, and 46/5 languages', () => {
  assert.equal(validateDataset(data), data);
  assert.equal(ids.length, 51);
  assert.equal(new Set(ids).size, 51);
  assert.deepEqual(data.collections.map(item => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(new Set(ids), new Set(data.terms.map(term => term.id)));
  assert.equal(data.terms.filter(term => term.language === 'Latin').length, 46);
  assert.equal(data.terms.filter(term => term.language === 'Law French').length, 5);
  assert.throws(() => validateDataset({ ...data, terms: data.terms.slice(1) }));
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
  assert.ok(criminalChoices.every(term => term.collection === 'Criminal law'));
  const interpretationChoices = quizChoices(data, 'noscitur-a-sociis');
  assert.ok(interpretationChoices.every(term => term.collection === 'Legal interpretation'));
});

test('reading and flipping do not inflate reviews or mastery; flash recall is tracked separately', () => {
  const state = freshProgress();
  const session = createFlashSession(['a-priori']);
  markRead(state, 'a-priori', '1');
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
  for (const id of ids.slice(0, 5)) { markRead(state, id, '1'); markRead(state, id, '1'); }
  assert.equal(state.recent.length, 5);
  assert.deepEqual(state.last, { id: ids[4], scope: '1' });
  assert.equal(masteredCount(state), 0);
  for (const id of data.collections[1].term_ids) markRead(state, id, '2');
  assert.deepEqual(state.recent, data.collections[1].term_ids, 'A new collection must not inherit another collection’s pending recall');
});

function masteredCount(state) { return ids.filter(id => isMastered(state, id)).length; }

test('milestone messages require complete recall mastery and are emitted once; collection text is rare within a session', () => {
  const state = freshProgress(), messages = new Set();
  for (const id of data.collections[0].term_ids) markRead(state, id, '1');
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
  markRead(state, 'de-jure', '2'); markRecall(state, 'de-jure', true); markFlash(state, 'de-jure', false);
  assert.equal(saveProgress(local, state), true);
  assert.deepEqual(loadProgress(local, data).state, state);
  local.setItem(STORAGE_KEY, '{ broken');
  assert.deepEqual(loadProgress(local, data).state, freshProgress());
  assert.deepEqual(normaliseProgress(null, data), freshProgress());
  assert.deepEqual(normaliseProgress({ version: 99 }, data), freshProgress());
  const partial = normaliseProgress({ terms: { 'de-jure': { read: true, mastered: true, reviewed: -4, remembered: 500, correct: 1, streak: 90 }, unknown: { read: true } }, last: { id: 'de-jure', scope: '1' }, recent: ['unknown', 'de-jure', 'de-jure'] }, data);
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

export const STORAGE_KEY = 'dicta.progress.v1';
export const WELCOME_KEY = 'dicta.welcome.v1';
const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000000) : 0;

export function blankTerm() {
  return { read: false, reviewed: 0, remembered: 0, correct: 0, missed: 0, streak: 0 };
}

export function freshProgress() {
  return { version: 1, terms: {}, last: null, milestones: { collections: [], all: false } };
}

export function normaliseProgress(raw, data) {
  const state = freshProgress();
  if (!raw || typeof raw !== 'object' || (raw.version !== undefined && raw.version !== 1)) return state;
  const known = new Set(data.terms.map(term => term.id));
  for (const id of known) {
    const saved = raw.terms?.[id];
    if (!saved || typeof saved !== 'object') continue;
    const term = blankTerm();
    term.read = saved.read === true;
    for (const field of ['reviewed', 'remembered', 'correct', 'missed']) term[field] = count(saved[field]);
    term.remembered = Math.min(term.remembered, term.reviewed);
    // Old "mastered" flags and reading counts are never accepted as recall evidence.
    term.streak = Math.min(count(saved.streak), term.correct, 2);
    state.terms[id] = term;
  }
  if (raw.last && known.has(raw.last.id)) {
    const collection = data.collections.find(item => String(item.id) === String(raw.last.scope));
    // Original releases used nine numeric collection IDs. Locate their new
    // collection by the saved term rather than reusing an unrelated ID.
    const legacy = /^[1-9]$/.test(String(raw.last.scope));
    const migrated = legacy ? data.collections.find(item => item.term_ids.includes(raw.last.id)) : collection;
    const scope = migrated?.term_ids.includes(raw.last.id) ? String(migrated.id) : 'all';
    state.last = { id: raw.last.id, scope };
  }
  const collectionIds = data.collections.map(collection => String(collection.id));
  if (Array.isArray(raw.milestones?.collections)) {
    state.milestones.collections = [...new Set(raw.milestones.collections.map(String).filter(id => collectionIds.includes(id)))];
  }
  state.milestones.all = raw.milestones?.all === true;
  return state;
}

export function loadProgress(storage, data) {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (!saved) return { state: freshProgress(), available: true };
    try {
      return { state: normaliseProgress(JSON.parse(saved), data), available: true };
    } catch {
      return { state: freshProgress(), available: true };
    }
  } catch {
    return { state: freshProgress(), available: false };
  }
}

export function saveProgress(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Call when Home is actually presented. Keep the caller's result for the page
// lifetime so blocked storage cannot cause the greeting to reappear on return.
export function consumeWelcome(storage) {
  try {
    if (storage.getItem(WELCOME_KEY) !== null) return false;
  } catch { /* Storage may be unavailable in a private browsing session. */ }
  let existingProgress = false;
  try {
    existingProgress = storage.getItem(STORAGE_KEY) !== null;
  } catch { /* A first presentation can still show the greeting safely. */ }
  try {
    storage.setItem(WELCOME_KEY, 'shown');
  } catch { /* The caller keeps this presentation consumed in memory. */ }
  return !existingProgress;
}

export const isMastered = (state, id) => (state.terms[id]?.streak || 0) >= 2;

export function markRead(state, id, scope) {
  const term = state.terms[id] ||= blankTerm();
  term.read = true;
  state.last = { id, scope };
}

export function markFlash(state, id, remembered) {
  const term = state.terms[id] ||= blankTerm();
  term.reviewed++;
  if (remembered) term.remembered++;
}

export function markRecall(state, id, correct, practice = false) {
  const term = state.terms[id] ||= blankTerm();
  if (correct) {
    term.correct++;
    if (!practice) term.streak = Math.min(2, term.streak + 1);
  } else {
    term.missed++;
    term.streak = 0;
  }
}

export function earnedEncouragement(state, data, sessionMessages) {
  let message = '';
  for (const collection of data.collections) {
    const id = String(collection.id);
    if (collection.term_ids.every(term => isMastered(state, term)) && !state.milestones.collections.includes(id)) {
      state.milestones.collections.push(id);
      if (!sessionMessages.has('collection')) {
        message = 'Mr Meyirbek would be proud.';
        sessionMessages.add('collection');
      }
    }
  }
  if (data.terms.every(term => isMastered(state, term.id)) && !state.milestones.all) {
    state.milestones.all = true;
    sessionMessages.add('all');
    message = "You've earned Mr Meyirbek's approval.";
  }
  return message;
}

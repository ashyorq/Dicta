export function validateDataset(data) {
  if (data?.collections?.length !== 3 || data?.terms?.length !== 51 || data?.metadata?.collections !== 3) {
    throw new Error('Expected 51 terms in three collections.');
  }
  if (new Set(data.collections.map(collection => collection.id)).size !== 3) throw new Error('Collection IDs must be unique.');
  const terms = new Map(data.terms.map(term => [term.id, term]));
  const ids = data.collections.flatMap(collection => collection.term_ids);
  if (terms.size !== 51 || ids.length !== 51 || new Set(ids).size !== 51 || ids.some(id => !terms.has(id))) {
    throw new Error('Every term must belong to exactly one collection.');
  }
  for (const collection of data.collections) {
    for (const id of collection.term_ids) {
      const term = terms.get(id);
      if (term.collection !== collection.title) throw new Error('Collection content does not match.');
      for (const field of ['id', 'term', 'language', 'university_definition', 'simple_explanation', 'legal_example', 'memory_note']) {
        if (typeof term[field] !== 'string' || !term[field].trim()) throw new Error(`Missing ${field}.`);
      }
    }
  }
  if (data.terms.filter(term => term.language === 'Latin').length !== 46 || data.terms.filter(term => term.language === 'Law French').length !== 5) {
    throw new Error('Unexpected vocabulary languages.');
  }
  return data;
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Neighbouring legal meanings give useful contrasts even across collections.
const meaningGroups = [
  ['a-priori', 'ab-initio', 'ante', 'ex-post-facto', 'inter-vivos', 'laches'],
  ['ad-hoc', 'de-novo', 'ex-gratia', 'pro-bono', 'bona-fide'],
  ['contra', 'contra-proferentem', 'ultra-vires', 'non-est-factum'],
  ['ergo', 'ipso-facto', 'res-ipsa-loquitur', 'prima-facie'],
  ['de-facto', 'de-jure', 'prima-facie', 'semble'],
  ['dictum', 'obiter-dictum', 'ratio-decidendi', 'stare-decisis', 'per-incuriam', 'per-curiam'],
  ['ejusdem-generis', 'noscitur-a-sociis', 'contra-proferentem', 'lacuna'],
  ['actus-reus', 'mens-rea', 'doli-incapax', 'mala-in-se', 'mala-prohibita'],
  ['modus-operandi', 'novus-actus-interveniens', 'res-gestae', 'res-ipsa-loquitur'],
  ['locus', 'locus-standi', 'chose', 'quantum'],
  ['consensus-ad-idem', 'non-est-factum', 'bona-fide', 'contra-proferentem'],
  ['inter-vivos', 'cy-pres', 'chose', 'pari-passu'],
  ['ex-parte', 'in-camera', 'voir-dire', 'habeas-corpus', 'locus-standi'],
  ['erratum', 'lacuna', 'per-incuriam', 'non-est-factum'],
];

export function quizChoices(data, id, random = Math.random) {
  const target = data.terms.find(term => term.id === id);
  if (!target) throw new Error('Unknown quiz term.');
  const related = new Set(meaningGroups.filter(group => group.includes(id)).flat());
  related.delete(id);
  const neighbours = shuffle(data.terms.filter(term => related.has(term.id)), random);
  const topic = target.topic || target.collection;
  const topicPeers = shuffle(data.terms.filter(term => term.id !== id && (term.topic || term.collection) === topic && !related.has(term.id)), random);
  const peers = shuffle(data.terms.filter(term => term.id !== id && term.collection === target.collection && (term.topic || term.collection) !== topic && !related.has(term.id)), random);
  const remaining = shuffle(data.terms.filter(term => term.id !== id && !related.has(term.id) && term.collection !== target.collection), random);
  const candidates = [...neighbours, ...topicPeers, ...peers, ...remaining];
  const answers = [target];
  for (const candidate of candidates) {
    if (!answers.some(term => term.simple_explanation === candidate.simple_explanation)) answers.push(candidate);
    if (answers.length === 4) break;
  }
  return shuffle(answers, random);
}

export function createFlashSession(ids, random = Math.random) {
  return { queue: shuffle(ids, random), position: 0, ids: [...ids], attempts: {}, finalRatings: {}, forgotten: {}, ratings: 0, revealed: false, feedback: null };
}

export function rateFlash(session, remembered) {
  if (!session.revealed || session.feedback || session.position >= session.queue.length) return null;
  const id = session.queue[session.position];
  session.attempts[id] = (session.attempts[id] || 0) + 1;
  session.finalRatings[id] = remembered;
  session.ratings++;
  if (!remembered) {
    session.forgotten[id] = (session.forgotten[id] || 0) + 1;
    if (session.attempts[id] < 3) session.queue.push(id);
  }
  session.feedback = { id, remembered, repeats: !remembered && session.attempts[id] < 3 };
  return session.feedback;
}

export function flashSummary(session) {
  const reviewed = Object.keys(session.finalRatings).length;
  const remembered = Object.values(session.finalRatings).filter(Boolean).length;
  return { reviewed, remembered, again: reviewed - remembered };
}

import { SYLLABLE_COUNTS } from './syllable-counts.mjs';

const SUB_SYLLABLES = [
  'cial', 'tia', 'cius', 'cious', 'uiet', 'gious', 'geous', 'priest', 'giu', 'dge',
  'ion', 'iou', 'sia$', '.che$', '.ched$', '.abe$', '.ace$', '.ade$', '.age$',
  '.aged$', '.ake$', '.ale$', '.aled$', '.ales$', '.ane$', '.ame$', '.ape$',
  '.are$', '.ase$', '.ashed$', '.asque$', '.ate$', '.ave$', '.azed$', '.awe$',
  '.aze$', '.aped$', '.athe$', '.athes$', '.ece$', '.ese$', '.esque$', '.esques$',
  '.eze$', '.gue$', '.ibe$', '.ice$', '.ide$', '.ife$', '.ike$', '.ile$', '.ime$',
  '.ine$', '.ipe$', '.iped$', '.ire$', '.ise$', '.ished$', '.ite$', '.ive$',
  '.ize$', '.obe$', '.ode$', '.oke$', '.ole$', '.ome$', '.one$', '.ope$', '.oque$',
  '.ore$', '.ose$', '.osque$', '.osques$', '.ote$', '.ove$', '.pped$', '.sse$',
  '.ssed$', '.ste$', '.ube$', '.uce$', '.ude$', '.uge$', '.uke$', '.ule$', '.ules$',
  '.uled$', '.ume$', '.une$', '.upe$', '.ure$', '.use$', '.ushed$', '.ute$',
  '.ved$', '.we$', '.wes$', '.wed$', '.yse$', '.yze$', '.rse$', '.red$', '.rce$',
  '.rde$', '.ily$', '.ely$', '.des$', '.gged$', '.kes$', '.ced$', '.ked$', '.med$',
  '.mes$', '.ned$', '.[sz]ed$', '.nce$', '.rles$', '.nes$', '.pes$', '.tes$',
  '.res$', '.ves$', 'ere$'
].map((pattern) => new RegExp(pattern));

const ADD_SYLLABLES = [
  'ia', 'riet', 'dien', 'ien', 'iet', 'iu', 'iest', 'io', 'ii', 'ily', '.oala$',
  '.iara$', '.ying$', '.earest', '.arer', '.aress', '.eate$', '.eation$',
  '[aeiouym]bl$', '[aeiou]{3}', '^mc', 'ism', 'asm', '([^aeiouy])1l$',
  '[^l]lien', '^coa[dglx].', '[^gq]ua[^auieo]', 'dnt$'
].map((pattern) => new RegExp(pattern));

const TARGETS = [5, 7, 5];
const MIN_HAIKU_WORDS = 3;

const SYLLABLE_OVERRIDES = new Map(Object.entries({
  are: 1,
  one: 1,
  two: 1,
  three: 1,
  four: 1,
  five: 1,
  six: 1,
  eight: 1,
  nine: 1,
  ten: 1,
  twelve: 1,
  every: [2, 3],
  fire: [1, 2],
  hour: [1, 2],
  rivers: 2,
  flowing: 2,
  haikpheus: 3,
  cloudflare: 2,
  emoji: 3
}));

export function isHaiku(text) {
  return analyzeHaiku(text).ok;
}

export function analyzeHaiku(text) {
  if (typeof text !== 'string') return { ok: false, lines: [], counts: [] };
  if (/```|`/.test(text)) return { ok: false, lines: [], counts: [], reason: 'code' };

  const explicitLines = stripSlackNoise(text).trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (explicitLines.length === 3) {
    const words = explicitLines.flatMap(cleanedWords);
    const counts = explicitLines.map((line) => likelyLineSyllables(cleanedWords(line)));
    const ok = words.length >= MIN_HAIKU_WORDS && explicitLines.every((line, index) => possibleLineSyllables(cleanedWords(line)).has(TARGETS[index]));
    return { ok, lines: explicitLines, counts: ok ? [...TARGETS] : counts };
  }

  const words = cleanedWords(text);
  const split = words.length >= MIN_HAIKU_WORDS ? splitHaiku(words) : null;
  if (split) return { ok: true, lines: split.map((items) => items.join(' ')), counts: [...TARGETS] };

  return greedyAnalysis(words);
}

export function syllableCounts(text) {
  return analyzeHaiku(text).counts;
}

function cleanedWords(text) {
  return normalizeNumbers(stripSlackNoise(text))
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\$/g, ' dollar ')
    .replace(/\bise\b/g, 'ize')
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .map(cleanedWord)
    .filter(Boolean);
}

function cleanedWord(word) {
  word = word.replace(/^'+|'+$/g, '');
  if (word in SYLLABLE_COUNTS || SYLLABLE_OVERRIDES.has(word)) return word;
  if (word.endsWith("'s")) return word.slice(0, -2);
  return word;
}

function stripSlackNoise(text) {
  return text
    .replace(/<https?:\/\/[^|>]+\|([^>]+)>/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[@#!][A-Z0-9][^>]*>/g, ' ')
    .replace(/<![^>]+>/g, ' ');
}

function normalizeNumbers(text) {
  return text.replace(/:?\b\d{1,6}\b:?/g, (token) => {
    const digits = token.replaceAll(':', '');
    return numberWords(Number(digits));
  });
}

function numberWords(number) {
  if (number < 20) return [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen'
  ][number];

  if (number < 100) {
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    return [tens[Math.floor(number / 10)], number % 10 ? numberWords(number % 10) : ''].filter(Boolean).join(' ');
  }

  if (number < 1000) {
    return [numberWords(Math.floor(number / 100)), 'hundred', number % 100 ? `and ${numberWords(number % 100)}` : ''].filter(Boolean).join(' ');
  }

  return [numberWords(Math.floor(number / 1000)), 'thousand', number % 1000 ? numberWords(number % 1000) : ''].filter(Boolean).join(' ');
}

function syllablesInWord(word) {
  return possibleSyllablesInWord(word)[0];
}

function possibleSyllablesInWord(word) {
  const dictionaryWord = dictionaryForm(word);
  if (SYLLABLE_OVERRIDES.has(dictionaryWord)) return asCounts(SYLLABLE_OVERRIDES.get(dictionaryWord));
  const dictionaryCounts = possibleDictionaryCounts(dictionaryWord);
  if (dictionaryCounts.length) return dictionaryCounts;

  const parts = dictionaryWord.toLowerCase().split(/[^aeiouy]+/).filter(Boolean);
  let syllables = parts.length;

  for (const pattern of SUB_SYLLABLES) if (pattern.test(dictionaryWord)) syllables -= 1;
  for (const pattern of ADD_SYLLABLES) if (pattern.test(dictionaryWord)) syllables += 1;

  return [Math.max(1, syllables)];
}

function possibleDictionaryCounts(word) {
  const counts = new Set();
  if (word in SYLLABLE_COUNTS) counts.add(SYLLABLE_COUNTS[word]);
  for (let index = 1; `${word}(${index})` in SYLLABLE_COUNTS; index += 1) {
    counts.add(SYLLABLE_COUNTS[`${word}(${index})`]);
  }
  return [...counts].sort((a, b) => a - b);
}

function possibleLineSyllables(words) {
  let totals = new Set([0]);
  for (const word of words) {
    const next = new Set();
    for (const total of totals) {
      for (const count of possibleSyllablesInWord(word)) next.add(total + count);
    }
    totals = next;
  }
  return totals;
}

function likelyLineSyllables(words) {
  return words.reduce((sum, word) => sum + syllablesInWord(word), 0);
}

function splitHaiku(words) {
  const lines = [[], [], []];
  const failed = new Set();

  function search(wordIndex, lineIndex, remaining) {
    if (lineIndex === TARGETS.length) return wordIndex === words.length;
    if (remaining === 0) return search(wordIndex, lineIndex + 1, TARGETS[lineIndex + 1]);
    if (wordIndex === words.length) return false;

    const key = `${wordIndex}:${lineIndex}:${remaining}`;
    if (failed.has(key)) return false;

    const word = words[wordIndex];
    for (const count of possibleSyllablesInWord(word)) {
      if (count > remaining) continue;
      lines[lineIndex].push(word);
      if (search(wordIndex + 1, lineIndex, remaining - count)) return true;
      lines[lineIndex].pop();
    }

    failed.add(key);
    return false;
  }

  return search(0, 0, TARGETS[0]) ? lines : null;
}

function greedyAnalysis(words) {
  const lines = [[], [], []];
  const counts = [0, 0, 0];
  let line = 0;

  for (const word of words) {
    const count = syllablesInWord(word);
    if (line > 2 || counts[line] + count > TARGETS[line]) {
      return { ok: false, lines: lines.map((items) => items.join(' ')), counts };
    }

    lines[line].push(word);
    counts[line] += count;
    if (counts[line] === TARGETS[line]) line += 1;
  }

  return { ok: false, lines: lines.map((items) => items.join(' ')), counts };
}

function asCounts(value) {
  return Array.isArray(value) ? value : [value];
}

function dictionaryForm(word) {
  if (word in SYLLABLE_COUNTS || SYLLABLE_OVERRIDES.has(word)) return word;

  for (const suffix of ['ies', 'es', 's']) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 1) continue;
    const stem = suffix === 'ies' ? `${word.slice(0, -3)}y` : word.slice(0, -suffix.length);
    if (stem in SYLLABLE_COUNTS || SYLLABLE_OVERRIDES.has(stem)) return stem;
  }

  return word;
}

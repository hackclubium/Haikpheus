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
  rivers: 2,
  flowing: 2
}));

export function isHaiku(text) {
  return analyzeHaiku(text).ok;
}

export function analyzeHaiku(text) {
  if (typeof text !== 'string') return { ok: false, lines: [], counts: [] };

  const explicitLines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (explicitLines.length === 3) {
    const counts = explicitLines.map((line) => cleanedWords(line).reduce((sum, word) => sum + syllablesInWord(word), 0));
    return { ok: counts.every((count, index) => count === TARGETS[index]), lines: explicitLines, counts };
  }

  const words = cleanedWords(text);
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

  return {
    ok: counts.every((count, index) => count === TARGETS[index]),
    lines: lines.map((items) => items.join(' ')),
    counts
  };
}

export function syllableCounts(text) {
  return analyzeHaiku(text).counts;
}

function cleanedWords(text) {
  return normalizeNumbers(text)
    .toLowerCase()
    .replace(/\$/g, ' dollar ')
    .replace(/\bise\b/g, 'ize')
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeNumbers(text) {
  return text.replace(/:?\b\d{1,6}\b:?/g, (token) => {
    const digits = token.replaceAll(':', '');
    const normalized = token.startsWith(':') && token.endsWith(':') ? digits.slice(-2) : digits;
    return numberWords(Number(normalized));
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
    return [numberWords(Math.floor(number / 100)), 'hundred', number % 100 ? numberWords(number % 100) : ''].filter(Boolean).join(' ');
  }

  return [numberWords(Math.floor(number / 1000)), 'thousand', number % 1000 ? numberWords(number % 1000) : ''].filter(Boolean).join(' ');
}

function syllablesInWord(word) {
  if (SYLLABLE_OVERRIDES.has(word)) return SYLLABLE_OVERRIDES.get(word);

  const parts = word.toLowerCase().split(/[^aeiouy]+/).filter(Boolean);
  let syllables = parts.length;

  for (const pattern of SUB_SYLLABLES) if (pattern.test(word)) syllables -= 1;
  for (const pattern of ADD_SYLLABLES) if (pattern.test(word)) syllables += 1;

  return Math.max(1, syllables);
}

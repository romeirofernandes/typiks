const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function hasVowel(clean) {
  return clean.split("").some((char) => VOWELS.has(char));
}

export function buildWordBank(wordsJson) {
  const seen = new Set();
  const source = Array.isArray(wordsJson) ? wordsJson : [];
  for (const word of source) {
    if (typeof word !== "string") continue;
    const clean = word.trim().toLowerCase();
    if (!/^[a-z]+$/.test(clean)) continue;
    if (clean.length < 4 || clean.length > 9) continue;
    if (!hasVowel(clean)) continue;
    if (new Set(clean).size <= 1) continue;
    seen.add(clean);
  }
  return Array.from(seen);
}

function shuffle(source) {
  const output = [...source];
  for (let i = output.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function pickWords(count, wordBank) {
  if (count <= 0 || wordBank.length === 0) return [];

  if (count <= wordBank.length) {
    return shuffle(wordBank).slice(0, count);
  }

  const output = [];
  while (output.length < count) {
    const needed = count - output.length;
    output.push(...shuffle(wordBank).slice(0, needed));
  }
  return output;
}

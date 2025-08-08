import { bannedWords } from './bannedWords.js';

// Pre-process banned words for easier checking
const processedBannedWords = bannedWords.map(word => createCanonicalForm(word));

// Create canonical form: lowercase, remove diacritics, normalize leetspeak, etc.
function createCanonicalForm(word) {
  const normalized = word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let canonical = normalized
    .replace(/[013457@$]/g, c => ({
      "1": "i", "3": "e", "4": "a", "@": "a",
      "0": "o", "$": "s", "5": "s", "7": "t"
    })[c] || c)
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/ch/g, 'sh')
    .replace(/ss/g, 's')
    .replace(/z/g, 's')
    .replace(/x/g, 'ks')
    .replace(/c/g, 'k')
    .replace(/t/g, 'th');

  canonical = canonical.replace(/[^a-z]/g, '');  // remove non-letters
  canonical = canonical.replace(/(.)\1+/g, '$1'); // collapse duplicates
  return canonical;
}

// Detects if text contains a dangerous sequence of letters (in order)
function containsLetterSequence(text, sequence) {
  let idx = 0;
  for (const char of text) {
    if (char === sequence[idx]) {
      idx++;
      if (idx === sequence.length) return true;
    }
  }
  return false;
}

export function isMessageClean(text) {
  const containsBadAss = /\b(dumbass|jackass|smartass|lazyass|asshole)\b/i.test(text);

  // Allow normal characters + emoji
  const keyboardAndEmojiPattern = /^[a-zA-Z0-9 `~!@#$%^&*()\-_=+\[\]{}|;:'",.<>\/?\\\p{Emoji}\s]*$/u;
  if (!keyboardAndEmojiPattern.test(text)) {
    Swal.fire({
      icon: 'error',
      title: 'Invalid Characters',
      text: 'Your message contains unsupported symbols. Please remove them and try again.',
      confirmButtonText: 'OK'
    });
    return false;
  }

  const canonicalText = createCanonicalForm(text);

  // 1. Exact or partial banned word matches
  const containsBanned = processedBannedWords.some(bannedWord => canonicalText.includes(bannedWord));

  // 2. Sequence detection for problematic words (like "hitler")
  const dangerousSequences = [
    "hitler",
    "nazi",
    "kkk"
  ];
  const containsSequence = dangerousSequences.some(seq => containsLetterSequence(canonicalText, seq));

  // 3. Start/end pattern match (to catch prefix/suffix use)
  const containsStartOrEndMatch = processedBannedWords.some(bw =>
    canonicalText.startsWith(bw) || canonicalText.endsWith(bw)
  );

  if (containsBanned || containsBadAss || containsSequence || containsStartOrEndMatch) {
    Swal.fire({
      icon: 'error',
      title: 'Message Blocked',
      text: 'Your message was blocked by the autofilter. Please review your message for inappropriate content.',
      confirmButtonText: 'OK'
    });
    return false;
  }

  return true;
}

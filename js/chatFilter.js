// improvedFilterWithFuse.js
import { bannedWords } from './bannedWords.js';

// Load Fuse.js (if not already loaded on the page)
if (typeof Fuse === 'undefined') {
  console.error("Fuse.js not loaded. Make sure you include it: https://cdn.jsdelivr.net/npm/fuse.js@6.6.2");
}

/**
 * Canonical form creator (safe: collapse sequences, no expansions)
 */
export function createCanonicalForm(word) {
  if (!word || typeof word !== 'string') return '';

  let s = word.normalize('NFKC').toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const charMap = {
    '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g',
    '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't',
    '\u0430': 'a', '\u0410': 'a', '\u0435': 'e', '\u0415': 'e',
    '\u043e': 'o', '\u041e': 'o', '\u0441': 'c', '\u0421': 'c',
    '\u0440': 'p', '\u0401': 'e', '\u0456': 'i',
    '\u03bf': 'o', '\u03b1': 'a', '\u03c1': 'p', '\u03c3': 's'
  };
  s = s.split('').map(ch => charMap[ch] || ch).join('');

  const seqMap = [
    ['ph', 'f'],
    ['th', 't'],
    ['sh', 's'],
    ['ch', 'k'],
    ['ck', 'k'],
    ['qu', 'k'],
    ['ss', 's']
  ];
  for (const [find, rep] of seqMap) {
    s = s.replace(new RegExp(find, 'g'), rep);
  }

  s = s.replace(/[^a-z0-9]/g, '');
  s = s.replace(/(.)\1+/g, '$1');
  return s;
}

// Pre-process banned words into canonical form for Fuse
const processedBannedWords = bannedWords
  .map(w => ({ original: w, canonical: createCanonicalForm(w) }))
  .filter(w => w.canonical);

// Fuse.js instance (searches in `canonical` field)
const fuse = new Fuse(processedBannedWords, {
  keys: ['canonical'],
  threshold: 0.3,        // adjust for strictness (0 = exact, 1 = very loose)
  minMatchCharLength: 3, // don’t fuzzy match very short strings (avoids false positives)
  distance: 50,
  includeScore: true
});

// SweetAlert helper
function showBlocked(title = 'Message Blocked', text = 'Your message was blocked by the autofilter. Please review your message for inappropriate content.') {
  if (typeof Swal !== 'undefined' && Swal && typeof Swal.fire === 'function') {
    Swal.fire({ icon: 'error', title, text, confirmButtonText: 'OK' });
  } else if (typeof alert !== 'undefined') {
    alert(`${title}\n\n${text}`);
  } else {
    console.warn(title, text);
  }
}

export function isMessageClean(text) {
  if (typeof text !== 'string') return true;
  if (!text.trim()) return true;

  const allowedPattern = /^[\p{L}\p{N}\p{P}\p{S}\s]*$/u;
  if (!allowedPattern.test(text)) {
    showBlocked('Invalid Characters', 'Your message contains unsupported symbols. Please remove them and try again.');
    return false;
  }

  // Check ass-related words directly
  if (/\b(dumbass|jackass|smartass|lazyass|asshole|ass)\b/i.test(text)) {
    showBlocked();
    return false;
  }

  // Canonicalize input
  const canonicalText = createCanonicalForm(text);

  // Direct substring check for obvious matches
  for (const w of processedBannedWords) {
    if (canonicalText.includes(w.canonical)) {
      showBlocked();
      return false;
    }
  }

  // Fuzzy search: break into words & check each one
  const tokens = text.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  for (const token of tokens) {
    const canonToken = createCanonicalForm(token);
    if (!canonToken) continue;

    // Exact canonical match
    if (processedBannedWords.some(w => w.canonical === canonToken)) {
      showBlocked();
      return false;
    }

    // Fuzzy search in Fuse
    const results = fuse.search(canonToken);
    if (results.length && results[0].score <= 0.3) {
      showBlocked();
      return false;
    }
  }

  return true;
}

import { bannedWords } from './bannedWords.js';

// Pre-process the banned words list for faster and more flexible pattern matching.
const processedBannedWords = bannedWords.map(word => createCanonicalForm(word));

function createCanonicalForm(word) {
  // Normalize, remove diacritics, and convert to lowercase
  const normalized = word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Leetspeak and phonetic/visual replacements
  let canonical = normalized
    // Leetspeak replacements
    .replace(/[013457@$]/g, c => ({ "1": "i", "3": "e", "4": "a", "@": "a", "0": "o", "$": "s", "5": "s", "7": "t" })[c] || c)
    // Common phonetic/visual substitutions
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/ch/g, 'sh') // Treat 'ch' and 'sh' as similar sounds for blocking purposes.
    .replace(/ss/g, 's')
    .replace(/z/g, 's')
    .replace(/x/g, 'ks')
    .replace(/c/g, 'k') // Treat 'c' and 'k' as the same.
    .replace(/t/g, 'th'); // Treat 't' and 'th' as similar

  // Remove common filler characters and duplicate letters
  canonical = canonical.replace(/[^a-z]/g, '');
  canonical = canonical.replace(/(.)\1+/g, '$1');

  return canonical;
}

export function isMessageClean(text) {
  const containsBadAss = /\b(dumbass|jackass|smartass|lazyass|asshole)\b/i.test(text);

  // Regex: Allows keyboard characters, numbers, and any character with the 'Emoji' Unicode property
  // The \p{Emoji} property is the most robust way to match all emojis.
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

  // Check the canonical form of the input text against the processed banned words.
  const canonicalText = createCanonicalForm(text);

  // Check for banned words in the canonical form
  const containsBanned = processedBannedWords.some(bannedWord => canonicalText.includes(bannedWord));

  if (containsBanned || containsBadAss) {
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





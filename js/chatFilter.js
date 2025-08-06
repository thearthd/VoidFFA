import { bannedWords } from './bannedWords.js';

// Pre-process the banned words list for faster and more flexible pattern matching.
const processedBannedWords = bannedWords.map(word => createCanonicalForm(word));

function createCanonicalForm(word) {
  // Normalize and remove diacritics
  const normalized = word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Leetspeak and visual replacements
  // 'ph' -> 'f', 'ck' -> 'k', 'ss' -> 's', etc.
  let canonical = normalized
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/ss/g, 's')
    .replace(/z/g, 's') // 'z' often replaces 's'
    .replace(/x/g, 'ks');

  // Remove common filler characters and duplicate letters
  canonical = canonical.replace(/[^a-z]/g, '');
  canonical = canonical.replace(/(.)\1+/g, '$1'); // e.g., 'hello' -> 'helo'

  return canonical;
}

export function isMessageClean(text) {
  const containsBadAss = /\b(dumbass|jackass|smartass|lazyass|asshole)\b/i.test(text);

  // Check the canonical form of the input text against the processed banned words.
  const canonicalText = createCanonicalForm(text);

  // Check for banned words in the canonical form
  const containsBanned = processedBannedWords.some(bannedWord => canonicalText.includes(bannedWord));

  if (containsBanned || containsBadAss) {
    // Swal.fire is not available in a backend context. 
    // You should separate the UI logic from the core function.
    // For now, let's assume this is client-side code and Swal.fire is available.
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

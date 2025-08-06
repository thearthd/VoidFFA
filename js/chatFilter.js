import { bannedWords } from './bannedWords.js';

export function isMessageClean(text) {
  // Normalize the input text: lowercase, remove diacritics, and replace numbers/symbols with their letter equivalents.
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Leetspeak replacements
  const leetMap = {
    "1": "i",
    "3": "e",
    "4": "a",
    "@": "a",
    "0": "o",
    "$": "s",
    "5": "s",
    "7": "t"
  };

  // Replace leet speak and remove all non-alphanumeric characters, including spaces.
  let cleanedText = normalized.replace(/[013457@$]/g, c => leetMap[c] || c);
  cleanedText = cleanedText.replace(/[^a-z]/g, "");

  // Specific check for 'ass' as a standalone word (e.g., in 'dumbass').
  // The word is only flagged if it's part of a known derogatory compound word.
  // We need to re-evaluate the original text to maintain word boundaries.
  const containsBadAss = text.toLowerCase().match(/\b(dumbass|jackass|smartass|lazyass|asshole)\b/);

  // Check for banned words in the fully cleaned text.
  const containsBanned = bannedWords.some(word => cleanedText.includes(word));

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

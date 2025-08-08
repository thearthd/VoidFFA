import { bannedWords } from './bannedWords.js';
import Swal from 'sweetalert2';

function createCanonicalForm(word) {
  let s = word.normalize('NFKC').toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const charMap = {
    '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's',
    '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's'
  };
  s = s.split('').map(ch => charMap[ch] || ch).join('');
  return s.replace(/[^a-z]/g, '');
}

// Pre-build regex patterns for each banned word
const bannedPatterns = bannedWords.map(word => {
  const canon = createCanonicalForm(word);
  const letters = canon.split('').join('.*'); // h.*i.*t.*l.*e.*r
  return new RegExp(letters, 'i'); // case-insensitive
});

function showBlocked(title, text) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({ icon: 'error', title, text, confirmButtonText: 'OK' });
  } else {
    alert(`${title}\n\n${text}`);
  }
}

export function isMessageClean(text) {
  if (typeof text !== 'string') return true;
  if (!text.trim()) return true;

  const allowedPattern = /^[\p{L}\p{N}\p{P}\p{S}\s]*$/u;
  if (!allowedPattern.test(text)) {
    showBlocked('Invalid Characters', 'Your message contains unsupported symbols.');
    return false;
  }

  // Canonicalize input
  const canonText = createCanonicalForm(text);

  // Pattern match
  for (const pattern of bannedPatterns) {
    if (pattern.test(canonText)) {
      showBlocked('Message Blocked', 'Your message was blocked by the autofilter.');
      return false;
    }
  }

  return true;
}

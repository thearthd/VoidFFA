import { bannedWords } from './bannedWords.js';

// --- Canonicalization Functions ---
// Create canonical form: lowercase, remove diacritics, normalize leetspeak, etc.
function createCanonicalForm(word) {
    const normalized = word
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    let canonical = normalized
        .replace(/[4@]/g, 'a')
        .replace(/[8]/g, 'b')
        .replace(/[k]/g, 'c')
        .replace(/[3]/g, 'e')
        .replace(/[6]/g, 'g')
        .replace(/[#]/g, 'h')
        .replace(/[1!|]/g, 'i')
        .replace(/[l]/g, 'i')
        .replace(/[0]/g, 'o')
        .replace(/[r]/g, 'r')
        .replace(/[z5$]/g, 's')
        .replace(/[7+]/g, 't')
        .replace(/[v]/g, 'u')
        .replace(/[w]/g, 'v')
        .replace(/[y]/g, 'u')
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/ss/g, 's');

    canonical = canonical.replace(/[^a-z]/g, '');
    canonical = canonical.replace(/(.)\1+/g, '$1');

    return canonical;
}

// Create a canonical form by sorting the letters alphabetically.
function createSortedCanonicalForm(word) {
    const canonical = createCanonicalForm(word);
    return canonical.split('').sort().join('');
}

// --- Pre-processing Banned Words ---
// The old approach: this is NOT how you catch anagrams.
// const processedBannedWords = bannedWords.map(word => createCanonicalForm(word));

// FIX: Create two separate lists: one for direct matching, one for anagram matching.
const processedCanonicalBannedWords = bannedWords.map(word => createCanonicalForm(word));
const processedSortedBannedWords = bannedWords.map(word => createSortedCanonicalForm(word));

// --- Main Filter Function ---
export function isMessageClean(text) {
    const containsBadAss = /\b(dumbass|jackass|smartass|lazyass|asshole)\b/i.test(text);

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
    const sortedCanonicalText = createSortedCanonicalForm(text);

    // 1. Check for canonical banned words (direct match)
    const containsBanned = processedCanonicalBannedWords.some(bannedWord => canonicalText.includes(bannedWord));

    // 2. Check for start/end patterns
    const containsStartOrEndMatch = processedCanonicalBannedWords.some(bw =>
        canonicalText.startsWith(bw) || canonicalText.endsWith(bw)
    );

    // 3. Check for letter swaps (anagrams)
    const containsAnagram = processedSortedBannedWords.some(sortedBannedWord =>
        sortedCanonicalText.includes(sortedBannedWord)
    );

    if (containsBanned || containsBadAss || containsStartOrEndMatch || containsAnagram) {
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

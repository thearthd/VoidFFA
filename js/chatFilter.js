import { bannedWords } from './bannedWords.js';

// A simple profanity filter using canonicalization and fuzzy matching.

// A list of common words that should never be blocked.
const allowedWords = ["wassup", "ass"];

// --- Canonicalization Functions ---
/**
 * Creates a basic canonical form of a word by lowercasing, removing diacritics,
 * and normalizing leetspeak characters.
 * @param {string} word The word to canonicalize.
 * @returns {string} The canonicalized word.
 */
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
        .replace(/[l]/g, 'l')
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
    
    return canonical;
}

// --- Fuzzy Matching Logic ---
/**
 * Determines if a given input is a close misspelling or variation of a banned word
 * by checking for a high percentage of character overlap.
 * @param {string} inputCanonical The canonical form of the user's input.
 * @param {string} bannedCanonical The canonical form of a banned word.
 * @returns {boolean} True if a fuzzy match is found.
 */
function isFuzzyMatch(inputCanonical, bannedCanonical) {
    // A direct substring match is the strongest form of fuzzy match.
    if (inputCanonical.includes(bannedCanonical) && inputCanonical.length > 3) {
        return true;
    }

    // Check for a high degree of character overlap.
    const minOverlapPercentage = 0.75; // 75% of letters must match
    let matchingCharacters = 0;
    let bannedChars = bannedCanonical.split('');

    for (const char of inputCanonical) {
        const index = bannedChars.indexOf(char);
        if (index !== -1) {
            matchingCharacters++;
            bannedChars.splice(index, 1);
        }
    }
    
    return matchingCharacters >= bannedCanonical.length * minOverlapPercentage;
}

// --- Main Filter Function ---
/**
 * Checks if a given text message contains any inappropriate content.
 * @param {string} text The text message to check.
 * @returns {boolean} True if the message is clean, false if it is blocked.
 */
export function isMessageClean(text) {
    // Split the text into words and check if any word is on the whitelist.
    const textWords = text.toLowerCase().split(/\s+/);
    for (const word of textWords) {
        if (allowedWords.includes(word)) {
            return true;
        }
    }

    // Continue with the original profanity filter logic if no allowed words are found.
    const canonicalText = createCanonicalForm(text);

    const containsBannedWord = bannedWords.some(bannedWord => {
        const canonicalBannedWord = createCanonicalForm(bannedWord);

        // Direct match or substring check
        if (canonicalText.includes(canonicalBannedWord)) {
            return true;
        }
        
        // Fuzzy match for misspellings and variations
        if (isFuzzyMatch(canonicalText, canonicalBannedWord)) {
            return true;
        }
        
        return false;
    });

    if (containsBannedWord) {
        // Swal must be loaded in your HTML for this to work
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

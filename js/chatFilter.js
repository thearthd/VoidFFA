import { bannedWords } from './bannedWords.js';

// A simple profanity filter using canonicalization and fuzzy matching.

// A list of common words that should never be blocked.
const allowedWords = ["wassup", "ass"];

// --- Canonicalization Functions ---
/**
 * Creates a basic canonical form of a word by lowercasing, removing diacritics,
 * and normalizing leetspeak characters.
 * This version is less aggressive to prevent false positives.
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
        .replace(/[3]/g, 'e')
        .replace(/[1!|]/g, 'i')
        .replace(/[0]/g, 'o')
        .replace(/[z5$]/g, 's')
        .replace(/[7+]/g, 't')
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/ss/g, 's');

    canonical = canonical.replace(/[^a-z]/g, '');
    
    return canonical;
}

// --- Levenshtein Distance for Robust Fuzzy Matching ---
/**
 * Calculates the Levenshtein distance between two strings.
 * @param {string} a The first string.
 * @param {string} b The second string.
 * @returns {number} The Levenshtein distance.
 */
function getLevenshteinDistance(a, b) {
    const matrix = [];
    // increment along the first column of each row
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    // increment each column in the first row
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1, // insertion
                    matrix[i - 1][j] + 1 // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Determines if a given input is a close misspelling or variation of a banned word
 * using Levenshtein distance.
 * @param {string} inputCanonical The canonical form of the user's input word.
 * @param {string} bannedCanonical The canonical form of a banned word.
 * @returns {boolean} True if a fuzzy match is found.
 */
function isFuzzyMatch(inputCanonical, bannedCanonical) {
    // Only perform a fuzzy match if the words are of a similar length.
    if (Math.abs(inputCanonical.length - bannedCanonical.length) > 2) {
        return false;
    }

    const distance = getLevenshteinDistance(inputCanonical, bannedCanonical);
    // A distance of 1 or 2 is a strong indicator of a typo or minor variation.
    return distance <= 2;
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
    
    // Split the input text into words for more precise checks.
    const inputWords = text.split(/\s+/).map(createCanonicalForm);

    const containsBannedWord = bannedWords.some(bannedWord => {
        const canonicalBannedWord = createCanonicalForm(bannedWord);

        for (const inputWord of inputWords) {
            // Direct match
            if (inputWord === canonicalBannedWord) {
                return true;
            }
            
            // Substring check (if a banned word is found inside another word)
            if (inputWord.includes(canonicalBannedWord) && canonicalBannedWord.length > 2) {
                return true;
            }

            // Fuzzy match for misspellings and variations
            if (isFuzzyMatch(inputWord, canonicalBannedWord)) {
                return true;
            }
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

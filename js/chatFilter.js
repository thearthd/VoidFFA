import bannedWords from './bannedWords.json' assert { type: 'json' };

function isMessageClean(text) {
    // Normalize for matching
    const normalized = text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, "");

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
    const leetNormalized = normalized.replace(/[013457@$]/g, c => leetMap[c] || c);

    // Special rule: allow "ass" unless part of insult
    const containsBadAss = /\bass\b/.test(leetNormalized) &&
        (/\b(?:dumbass|jackass|smartass|lazyass|asshole)\b/.test(leetNormalized));

    // Check banned list
    const containsBanned = bannedWords.some(word => leetNormalized.includes(word));

    return !(containsBanned || containsBadAss);
}

export { isMessageClean };

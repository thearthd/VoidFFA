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

  // Keyboard characters whitelist
  const keyboardChars = `a-zA-Z0-9 \\\`~!@#\\$%\\^&\\*\\(\\)\\-_=\\+\\[\\]{}\\|;:'",.<>\\/\\?\\\\`;

  // Emoji ranges (covers most modern emojis)
  const emojiRanges = [
    '\u231A-\u231B', // ⌚⌛
    '\u23E9-\u23F3', // ⏩⏳
    '\u23F8-\u23FA', // ⏸⏺
    '\u24C2',        // Ⓜ
    '\u25AA-\u25AB', // ▪▫
    '\u25B6',        // ▶
    '\u25C0',        // ◀
    '\u25FB-\u25FE', // ◻◾
    '\u2600-\u2604', // ☀☄
    '\u260E',        // ☎
    '\u2611',        // ☑
    '\u2614-\u2615', // ☔☕
    '\u2618',        // ☘
    '\u261D',        // ☝
    '\u2620',        // ☠
    '\u2622-\u2623', // ☢☣
    '\u2626',        // ☦
    '\u262A',        // ☪
    '\u262E-\u262F', // ☮☯
    '\u2638-\u263A', // ☸☺
    '\u2640',        // ♀
    '\u2642',        // ♂
    '\u2648-\u2653', // ♈-♓ (zodiac)
    '\u265F-\u2660', // ♟♠
    '\u2663-\u2666', // ♣♦
    '\u2668',        // ♨
    '\u267B',        // ♻
    '\u267E-\u267F', // ♾♿
    '\u2692-\u2697', // ⚒⚗
    '\u2699',        // ⚙
    '\u269B-\u269C', // ⚛⚜
    '\u26A0-\u26A1', // ⚠⚡
    '\u26A7',        // ⚧
    '\u26AA-\u26AB', // ⚪⚫
    '\u26B0-\u26B1', // ⚰⚱
    '\u26BD-\u26BE', // ⚽⚾
    '\u26C4-\u26C5', // ⛄⛅
    '\u26C8',        // ⛈
    '\u26CE-\u26CF', // ⛎⛏
    '\u26D1',        // ⛑
    '\u26D3-\u26D4', // ⛓⛔
    '\u26E9-\u26EA', // ⛩⛪
    '\u26F0-\u26F5', // ⛰⛵
    '\u26F7-\u26FA', // ⛷⛺
    '\u26FD',        // ⛽
    '\u2702',        // ✂
    '\u2705',        // ✅
    '\u2708-\u270D', // ✈✍
    '\u270F',        // ✏
    '\u2712',        // ✒
    '\u2714',        // ✔
    '\u2716',        // ✖
    '\u271D',        // ✝
    '\u2721',        // ✡
    '\u2728',        // ✨
    '\u2733-\u2734', // ✳✴
    '\u2744',        // ❄
    '\u2747',        // ❇
    '\u274C',        // ❌
    '\u274E',        // ❎
    '\u2753-\u2755', // ❓❕
    '\u2757',        // ❗
    '\u2763-\u2764', // ❣❤
    '\u2795-\u2797', // ➕➗
    '\u27A1',        // ➡
    '\u27B0',        // ➰
    '\u27BF',        // ➿
    '\u2934-\u2935', // ⤴⤵
    '\u2B05-\u2B07', // ⬅⬇
    '\u2B1B-\u2B1C', // ⬛⬜
    '\u2B50',        // ⭐
    '\u2B55',        // ⭕
    '\u3030',        // 〰
    '\u303D',        // 〽
    '\u3297',        // 🉑
    '\u3299',        // 🈹
    '\u1F004',       // 🀄
    '\u1F0CF',       // 🃏
    '\u1F170-\u1F171', // 🅰🅱
    '\u1F17E-\u1F17F', // 🅾🅿
    '\u1F18E',       // 🆎
    '\u1F191-\u1F19A', // 🆑-🆚
    '\u1F1E6-\u1F1FF', // Flags
    '\u1F201-\u1F202', // 🈁🈂
    '\u1F21A',       // 🈚
    '\u1F22F',       // 🈯
    '\u1F232-\u1F23A', // 🈲🈺
    '\u1F250-\u1F251', // 🉐🉑
    '\u1F300-\u1F6FF', // Weather, transport, misc
    '\u1F7E0-\u1F7EB', // Color circles
    '\u1F90C-\u1F93A', // Gestures, activities
    '\u1F93C-\u1F945', // Sports
    '\u1F947-\u1F9FF', // Awards, clothing, animals, food
    '\u1FA70-\u1FAFF', // Objects, instruments, misc
    '\u1FC00-\u1FCFF'  // Extra emoji symbols
  ].join('');

  const pattern = new RegExp(`^[${keyboardChars}${emojiRanges}]*$`, 'u');

  if (!pattern.test(text)) {
    Swal.fire({
      icon: 'error',
      title: 'Invalid Characters',
      text: 'Your message contains unsupported symbols (except emojis). Please remove them and try again.',
      confirmButtonText: 'OK'
    });
    return false;
  }

  const canonicalText = createCanonicalForm(text);
  const containsBanned = processedBannedWords.some(bannedWord =>
    canonicalText.includes(bannedWord)
  );

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




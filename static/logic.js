// Pure text logic: compares what the student should say with what the recognizer heard.
// Kept separate from the screens so it can be tested on its own.
(function (root) {
  'use strict';

  const CONTRACTIONS = {
    "i'm": 'i am', "i'd": 'i would', "i'll": 'i will', "i've": 'i have', "it's": 'it is',
    "that's": 'that is', "what's": 'what is', "where's": 'where is', "how's": 'how is',
    "here's": 'here is', "there's": 'there is', "he's": 'he is', "she's": 'she is',
    "you're": 'you are', "we're": 'we are', "they're": 'they are', "don't": 'do not',
    "doesn't": 'does not', "didn't": 'did not', "can't": 'can not', "cannot": 'can not',
    "couldn't": 'could not', "isn't": 'is not', "aren't": 'are not', "won't": 'will not',
    "wouldn't": 'would not', "let's": 'let us', "ok": 'okay',
    "we'd": 'we would', "you'd": 'you would', "we'll": 'we will', "you'll": 'you will',
    "it'll": 'it will', "they'll": 'they will', "he'll": 'he will', "she'll": 'she will',
    "you've": 'you have', "we've": 'we have', "they've": 'they have', "haven't": 'have not',
    "hasn't": 'has not', "wasn't": 'was not', "weren't": 'were not', "shouldn't": 'should not',
    "who's": 'who is',
    // words the recognizer may write as one word or two
    checkout: 'check out', checkin: 'check in', takeout: 'take out', pickup: 'pick up',
    copay: 'co pay', email: 'e mail', goodbye: 'good bye', lunchbox: 'lunch box',
    stomachache: 'stomach ache', earache: 'ear ache', headache: 'head ache',
  };
  const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve'];

  // "I'd like 4, please." -> ["i","would","like","four","please"]
  function tokens(text) {
    return String(text).toLowerCase().replace(/wi[- ]?fi/g, 'wifi').replace(/[‘’`]/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/)
      .map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean)
      .flatMap((w) => {
        if (Object.prototype.hasOwnProperty.call(CONTRACTIONS, w)) return CONTRACTIONS[w].split(' ');
        if (/^\d+$/.test(w) && NUMBERS[Number(w)]) return [NUMBERS[Number(w)]];
        return [w.replace(/'s$/, 's')];  // "driver's" and "drivers" count as the same word
      });
  }

  // Marks which words of `target` were found, in order, inside `heard`.
  function compare(target, heard) {
    const words = String(target).split(/\s+/).filter(Boolean);
    const perWord = words.map(tokens);
    const T = perWord.flat();
    const H = tokens(heard);
    const m = T.length, n = H.length;
    const L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        L[i][j] = T[i] === H[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    const ok = new Array(m).fill(false);
    for (let i = 0, j = 0; i < m && j < n;) {
      if (T[i] === H[j]) { ok[i] = true; i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    }
    let k = 0;
    const marks = perWord.map((ts) => {
      const hit = ts.length > 0 && ts.every((_, x) => ok[k + x]);
      k += ts.length;
      return hit;
    });
    const matched = ok.filter(Boolean).length;
    return {
      words: words.map((w, i) => ({ text: w, ok: marks[i] })),
      score: m ? Math.round((100 * matched) / m) : 0,
    };
  }

  // Of several recognizer guesses, keep the one closest to the target.
  function best(target, alternatives) {
    let top = null;
    for (const heard of alternatives) {
      const r = compare(target, heard);
      if (!top || r.score > top.score) top = Object.assign(r, { heard });
    }
    return top;
  }

  // Word tiles for the listening exercise.
  function tiles(sentence) {
    return String(sentence).split(/\s+/).map((w) => w.replace(/[.,!?]/g, '')).filter(Boolean)
      .map((w, i) => (i === 0 && !/^I('|$)/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w));
  }

  function shuffled(list) {
    const a = list.slice();
    if (a.length < 2) return a;
    for (let tries = 0; tries < 10; tries++) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      if (a.some((w, i) => w !== list[i])) break;
    }
    return a;
  }

  const api = { tokens, compare, best, tiles, shuffled };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);

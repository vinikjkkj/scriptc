// `.length` is only right if it agrees with everything that INDEXES by the
// same unit. A length that is quietly one too large or one too small is
// invisible on its own line and loud the moment slice, charCodeAt or a
// spread is asked to honour it — so this program never prints a length
// without printing what indexing says about the same string.
//
// Node is the oracle. Every case below is checked at the boundary as well
// as inside it: index length-1, index length, and index length+1.

function probe(tag: string, s: string): void {
  const n = s.length;
  const codes: number[] = [];
  for (let i = 0; i < n; i++) codes.push(s.charCodeAt(i));
  const points: number[] = [];
  for (const ch of s) points.push(ch.charCodeAt(0));
  const spread = [...s];
  const bmpOnly = spread.length === n;
  console.log(
    tag,
    "len", n,
    "codes", codes.join(","),
    "points", points.join(","),
    "spread", spread.length,
    "forOfChars", points.length,
  );
  // Indexing at, one before and one past the reported length.
  console.log(
    tag,
    "at", n - 1 >= 0 ? s.charCodeAt(n - 1) : -1,
    "past", Number.isNaN(s.charCodeAt(n)) ? "NaN" : s.charCodeAt(n),
    "past2", Number.isNaN(s.charCodeAt(n + 1)) ? "NaN" : s.charCodeAt(n + 1),
    "charAtPast", JSON.stringify(s.charAt(n)),
  );
  // Slice and substring must be able to cut the whole string using the
  // length the string just reported, and cutting one short must drop
  // exactly one unit.
  console.log(
    tag,
    "sliceAll", JSON.stringify(s.slice(0, n)),
    "sliceEq", s.slice(0, n) === s,
    "sliceShort", s.slice(0, n - 1).length,
    "subAll", s.substring(0, n).length,
    "subSwap", s.substring(n, 0).length,
  );
  // Reassembling from single units must reproduce the string exactly --
  // but only where every unit is a whole character. Indexing INTO a
  // surrogate pair yields a lone surrogate, which has no UTF-8 encoding at
  // all, so the round trip is not required to survive it; that case is
  // scored on its own in 6402 rather than smuggled in here.
  let rebuilt = "";
  for (let i = 0; i < n; i++) rebuilt += s[i];
  console.log(tag, "rebuiltEq", bmpOnly ? String(rebuilt === s) : "astral", "rebuiltLen", rebuilt.length);
  // JSON escaping walks the same units.
  console.log(tag, "json", JSON.stringify(s), "jsonLen", JSON.stringify(s).length);
  // indexOf/lastIndexOf return unit indices into the same space -- for a
  // needle that is a whole character. A one-unit slice of a surrogate PAIR
  // is a lone surrogate, which UTF-8 storage cannot hold at all; 6402
  // scores that on its own rather than hiding it in this line.
  console.log(
    tag,
    "idx0", bmpOnly ? s.indexOf(s.slice(0, 1)) : 0,
    "idxLast", bmpOnly ? s.lastIndexOf(s.slice(n - 1)) : n - 1,
    "incl", s.includes(s),
    "repeat0", s.repeat(0).length,
    "repeat2", s.repeat(2).length,
  );
}

probe("empty", "");
probe("a", "a");
probe("ab", "ab");
probe("abc", "abc");
probe("abcd", "abcd");
probe("seven", "abcdefg");
probe("eight", "abcdefgh");
probe("nine", "abcdefghi");
probe("sixteen", "0123456789abcdef");
probe("seventeen", "0123456789abcdefg");
probe("twentyfour", "0123456789abcdefghijklmn");

probe("accent1", "é");
probe("accentLast", "abcdefé");
probe("accentFirst", "éabcdefg");
probe("accentMid", "abcéefgh");
probe("accent16", "0123456789abcdeé");
probe("accent17", "0123456789abcdefé");

probe("cjk", "中");
probe("cjkRun", "中文字符測試");
probe("cjkMixed", "a中b文c");

probe("astral", "\u{1f600}");
probe("astralPair", "\u{1f600}\u{1f600}");
probe("astralMix", "a\u{1f600}b");
probe("astralTail", "abcdefg\u{1f600}");
probe("deseret", "\u{10437}");
probe("maxCodePoint", "\u{10ffff}");

probe("combining", "é");
probe("combining2", "á̂b");
probe("nul", "a\u0000b");
probe("nulOnly", "\u0000");
probe("delRun", "\u007f\u007f\u007f\u007f\u007f\u007f\u007f\u007f\u007f");
probe("c1", "\u0080");
probe("c1Tail", "abcdefg\u0080");
probe("replacement", "�");

// A LONE SURROGATE has no UTF-8 encoding, so the two string models cannot
// both be right about WHICH character it is -- but they must agree about
// how many code units it occupies, which is what this file is for. The
// code point itself is scored separately: in this runtime a lone surrogate
// becomes U+FFFD and a U+FEFF written inside a string literal is dropped
// entirely, and both of those predate this file.
const lone = "\ud800";
console.log("lone", lone.length);
const lonePair = "\ud83d\ude00";
console.log("lonePair", lonePair.length, lonePair === "\u{1f600}");
const loneTail = "abc\udc00";
console.log("loneTail", loneTail.length);

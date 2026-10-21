// exec on /g and /y regexes (stateful through lastIndex), the .index of a
// const-stored exec result, lastIndex reads and writes, a flagged literal
// that is a fresh object per evaluation, and the escape-loop idiom.
const g = /[ab]/g;
const text = "xxaybzab";
let guard = 0;
for (;;) {
  const m = g.exec(text);
  if (m === null) break;
  console.log("hit", m[0], m.index, g.lastIndex);
  if (++guard > 10) break;
}
console.log("after loop", g.lastIndex);

const y = /a/y;
console.log(y.test("aab"), y.lastIndex, y.test("aab"), y.lastIndex, y.test("aab"), y.lastIndex);
y.lastIndex = 1;
console.log(y.exec("ba") !== null, y.lastIndex);
y.lastIndex = 99;
console.log(y.exec("aaa"), y.lastIndex);

const escapeChars = /[\0\b\t\n\r\x1a"'\\]/g;
function escapeString(value: string): string {
  escapeChars.lastIndex = 0;
  const first = escapeChars.exec(value);
  if (first === null) return `'${value}'`;
  const length = value.length;
  let result = "'" + value.slice(0, first.index);
  let chunkStart = first.index;
  for (let i = first.index; i < length; i++) {
    let escaped: string;
    switch (value.charCodeAt(i)) {
      case 34: escaped = '\\"'; break;
      case 39: escaped = "\\'"; break;
      case 92: escaped = "\\\\"; break;
      case 10: escaped = "\\n"; break;
      default:
        continue;
    }
    result += value.slice(chunkStart, i) + escaped;
    chunkStart = i + 1;
  }
  return result + value.slice(chunkStart) + "'";
}
console.log(escapeString("plain"), escapeString("it's"), escapeString('a"b\\c\nd'), escapeString("''"), escapeString(""));

function fresh(): number {
  const r = /b/g;
  r.exec("abab");
  return r.lastIndex;
}
console.log(fresh(), fresh(), fresh());

function rest(): void {
  const plain = /(\d+)-(\d+)/;
  const p = plain.exec("ab 12-34 cd");
  if (p !== null) console.log(p[0], p[1], p[2], p.index);
  const none = plain.exec("nothing");
  console.log(none === null);
  const uni = /é/g;
  const u = uni.exec("aé€é");
  if (u !== null) console.log(u.index, uni.lastIndex);
  const first = uni.exec("aé€é");
  if (first !== null) console.log(first.index, uni.lastIndex);
  console.log(uni.exec("aé€é"), uni.lastIndex);
}
rest();

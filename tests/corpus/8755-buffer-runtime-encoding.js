function enc(string, encoding) { return Buffer.from(string, encoding); }
console.log(enc('héllo', 'utf8'), enc('68656c6c6f', 'hex'), enc('aGk=', 'base64'), enc('日本', 'UCS2'), enc('abc', undefined));
console.log(enc(Buffer.from('xyz'), 'hex'), enc([1, 2, 3], 'utf8'));
try { enc('x', 'nope'); } catch (e) { console.log(e.name, e.code, e.message); }
try { enc('x', 5); } catch (e) { console.log(e.name, e.code, e.message); }
function dec(buffer, encoding, start, end) { return buffer.toString(encoding, start, end); }
const b = Buffer.from('héllo wörld');
console.log(dec(b, 'utf8', 0, 6), dec(b, 'hex', 1, 4), dec(b, 'LATIN1', 0, 3), dec(b, undefined, 0, 2), dec('str', 'hex', 0, 1), dec([1, 2], 'zzz', 0, 1));
try { dec(b, 'nope', 0, 1); } catch (e) { console.log(e.name, e.code, e.message); }
function round(s, e) { return Buffer.isEncoding(e) ? Buffer.from(s, e).toString(e, 0, 100) : 'n/a'; }
console.log(round('hello', 'hex'), round('hello', 'base64'), round('zz', 'bad'));
const hb = Buffer.from('hi');
for (const e of [5, '', null, undefined, 'zz', true]) {
  let a, c;
  try { a = Buffer.from('hi', e).toString(); } catch (x) { a = x.message; }
  try { c = hb.toString(e); } catch (x) { c = x.message; }
  console.log(String(e), JSON.stringify(a), JSON.stringify(c));
}

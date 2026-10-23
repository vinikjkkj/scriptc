function bl(string, enc) { return Buffer.byteLength(string, 'utf8') + (Buffer.isEncoding(enc) ? 100 : 0); }
console.log(bl('héllo', 'utf8'), bl('x', 'nope'), bl('日本', 'latin1'), bl('', 'HEX'), bl('abc', 5), bl('abc'));
function bl2(string, enc) { return Buffer.byteLength(string, enc); }
console.log(bl2('héllo', 'utf8'), bl2('日本', 'latin1'), bl2('日本', 'UCS2'), bl2('abcd', 'hex'), bl2('abcd==', 'base64'), bl2('x', 'zzz'), bl2('x', undefined), bl2('x', 7));
console.log(bl2(Buffer.from("abc"), undefined), bl2(new Uint8Array(4)));
try { bl2(5); } catch (e) { console.log(e.code, e.message); }
try { bl2({}); } catch (e) { console.log(e.code, e.name); }
function isE(x) { return Buffer.isEncoding(x); }
console.log(isE('hex'), isE('UTF-8'), isE('zzz'), isE(5), isE(null), isE(undefined), isE(''));

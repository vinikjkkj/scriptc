// toLocaleLowerCase / toLocaleUpperCase with a locale on a dyn string: tr, az, lt, el special casing, the root for every other tag, Node's errors.
const s: any = JSON.parse('"Iıİi I\\u0307 i\\u0307 \\u00ccJ\\u012e\\u0301 \\u03ac\\u03af \\u03ae \\u03b1\\u03ae \\u0390 \\u03b9\\u0308 \\u1fb3 \\u03c3\\u03c2 Σ"');
for (const tag of ["tr", "az-Latn", "lt", "el", "el-GR", "en", "TR-tr", "ell", "tur"]) console.log(tag, s.toLocaleLowerCase(tag), s.toLocaleUpperCase(tag));
console.log(s.toLocaleUpperCase(["tr", "en"]), s.toLocaleUpperCase(["en", "tr"]), s.toLocaleUpperCase([]), s.toLocaleUpperCase(undefined), s.toLocaleLowerCase(5));
for (const bad of ["x", "tr_TR", "", "tr-", "tr-u-x", "en-a", "abcd"]) { try { s.toLocaleUpperCase(bad); } catch (e) { console.log(JSON.stringify(bad), (e as Error).name, (e as Error).message); } }
try { s.toLocaleUpperCase(null); } catch (e) { console.log((e as Error).name, (e as Error).message); }
try { s.toLocaleUpperCase([5]); } catch (e) { console.log((e as Error).name, (e as Error).message); }
const t: any = JSON.parse('"\\u03b9\\u0301 \\u03ac\\u03b9 \\u03ae. \\u03ae\\u03b1"');
console.log(t.toLocaleUpperCase("el"), t.toLocaleLowerCase("el"));

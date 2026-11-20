// toLocaleLowerCase / toLocaleUpperCase on a typed string: no locale, a string tag, a list, undefined, and Node's errors.
const s: string = "Iıİi İ i̇ ÌJĮ́ άί ή αή ΐ ϊ ᾳ σς Σ";
console.log(s.toLocaleLowerCase(), s.toLocaleUpperCase());
for (const tag of ["tr", "az-Latn", "lt", "el", "el-GR", "en", "TR-tr", "ell", "tur"]) console.log(tag, s.toLocaleLowerCase(tag), s.toLocaleUpperCase(tag));
console.log(s.toLocaleUpperCase(["tr", "en"]), s.toLocaleUpperCase(["en", "tr"]), s.toLocaleUpperCase([]), s.toLocaleUpperCase(undefined));
const maybe: string | undefined = process.argv.length > 50 ? "tr" : undefined;
const list: string[] = process.argv.length > 50 ? [] : ["lt"];
console.log(s.toLocaleLowerCase(maybe), s.toLocaleLowerCase(list));
for (const bad of ["x", "tr_TR", "", "tr-", "tr-u-x", "en-a", "abcd"]) {
  try { s.toLocaleUpperCase(bad); } catch (e) { console.log(JSON.stringify(bad), (e as Error).name, (e as Error).message); }
}
function up(w: string, loc: string): string { return w.toLocaleUpperCase(loc); }
console.log(up("istanbul", "tr"), up("istanbul", "en"), up("i", "lt"));

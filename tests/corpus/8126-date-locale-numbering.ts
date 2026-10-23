// Every numbering system as a literal option and through -u-nu-: date digits, and the algorithmic systems (hanidec, roman, hebr, jpanyear overrides) a pattern asks for.
// Compared byte-for-byte with node (ICU 78.2 / CLDR 48 locale data): every line is the formatter's answer for one
// locale x options x instant; a throw prints its name and message (V8's own).
function show(f: () => string): void {
  try {
    console.log(f());
  } catch (e) {
    const x = e as Error;
    console.log(x.name + ": " + x.message);
  }
}
const nus: string[] = ["arab","arabext","beng","deva","fullwide","gujr","guru","hanidec","khmr","knda","laoo","latn","limb","mlym","mong","mymr","orya","tamldec","telu","thai","tibt","adlm","bali","brah","cakm","cham","java","kali","lana","lepc","mtei","nkoo","olck","osma","saur","shrd","sund","takr","vaii","hmnp","rohg","segment"];
const locales: string[] = ["en","ar","fa","hi","th","ja","zh","he","bn","my"];
const d = new Date(1700000000123);
for (const l of locales) {
  for (const nu of nus) {
    show(() => d.toLocaleString(l, { numberingSystem: nu, timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { numberingSystem: nu, dateStyle: "full", timeStyle: "medium", timeZone: "UTC" }));
    show(() => d.toLocaleString(l + "-u-nu-" + nu, { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, timeZone: "UTC" }));
  }
}

// BCP 47 -u- extensions in the locale tag (hc, nu, ca and their combinations), unknown and malformed ones, several tags and the lookup fallback.
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
const exts: string[] = ["-u-hc-h11", "-u-hc-h12", "-u-hc-h23", "-u-hc-h24", "-u-nu-arab", "-u-nu-deva", "-u-nu-thai", "-u-ca-buddhist", "-u-ca-islamic", "-u-ca-hebrew", "-u-ca-japanese", "-u-ca-chinese", "-u-nu-thai-ca-buddhist", "-u-ca-japanese-hc-h11", "-u-ca-gregory-nu-latn", "-u-ca-bogus", "-u-nu-bogus", "-u-hc-bogus", "-u-x-foo", "-x-private"];
const bases: string[] = ["en", "en-US", "de", "ar", "fa", "ja", "th", "he", "zh", "hi"];
const d = new Date(1700000000123);
for (const b of bases) {
  for (const e of exts) {
    show(() => d.toLocaleString(b + e, { timeZone: "UTC" }));
    show(() => d.toLocaleString(b + e, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }));
  }
}
show(() => d.toLocaleString(["xx", "de-AT", "en"], { timeZone: "UTC" }));
show(() => d.toLocaleString(["xx-YY", "yy"], { timeZone: "UTC" }));
show(() => d.toLocaleString("en-us", { timeZone: "UTC" }));
show(() => d.toLocaleString("EN_us", { timeZone: "UTC" }));
show(() => d.toLocaleString("", { timeZone: "UTC" }));
show(() => d.toLocaleString("en-", { timeZone: "UTC" }));
show(() => d.toLocaleString([], { timeZone: "UTC" }));
show(() => d.toLocaleString(["fr", "fr"], { timeZone: "UTC" }));
// V8 keeps one default formatter per method kind, keyed by the locales string, for (locales, undefined) calls: the
// empty string shares the key of undefined while that entry is held.
show(() => d.toLocaleString(""));
d.toLocaleString(undefined);
show(() => d.toLocaleString(""));
show(() => d.toLocaleDateString(""));
d.toLocaleDateString(undefined);
show(() => d.toLocaleDateString(""));
show(() => d.toLocaleTimeString(""));
d.toLocaleString("de");
show(() => d.toLocaleString(""));
d.toLocaleString(undefined);
show(() => d.toLocaleString("", {}));
show(() => d.toLocaleString(""));
show(() => (1).toLocaleString(""));
(1).toLocaleString(undefined);
show(() => (1).toLocaleString(""));
show(() => (1n).toLocaleString(""));
(1n).toLocaleString("fr");
show(() => (1).toLocaleString(""));

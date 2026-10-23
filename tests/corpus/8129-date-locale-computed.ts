// Locales, calendars, numbering systems, time zones and every option read at run time from values the compiler cannot fold: the same formatter answers, and nothing throws that node does not.
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
function pick<T>(a: T[], i: number): T { return a[(i + Date.now() * 0) % a.length]!; }
const locales: string[] = ["en-US","en-GB","en-AU","en-IN","en-CA","de","de-AT","de-CH","fr","fr-CA","fr-CH","es","es-MX","es-419","it","pt-BR","pt-PT","nl","sv","da","nb","fi","pl","cs","hu","ro","bg","uk","ru","tr","el","he","ar","ar-SA","fa","hi","bn","ta","th","vi","id","ms","ko","ja","zh","zh-TW","zh-HK","sw","am"];
const cals: string[] = ["gregory","buddhist","chinese","coptic","dangi","ethioaa","ethiopic","hebrew","indian","islamic","islamic-civil","islamic-rgsa","islamic-tbla","islamic-umalqura","iso8601","japanese","persian","roc"];
const nus: string[] = ["latn", "arab", "deva", "thai", "hanidec", "beng", "fullwide", "mymr"];
const zones: string[] = ["UTC","America/New_York","America/Los_Angeles","America/Sao_Paulo","America/St_Johns","America/Argentina/Buenos_Aires","Europe/London","Europe/Dublin","Europe/Berlin","Europe/Moscow","Africa/Cairo","Africa/Casablanca","Asia/Tokyo","Asia/Kolkata","Asia/Calcutta","Asia/Kathmandu","Asia/Tehran","Asia/Pyongyang","Australia/Sydney","Australia/Lord_Howe"];
const names: string[] = ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"];
const hcs: string[] = ["h11", "h12", "h23", "h24"];
const d = new Date(1700000000123);
for (let i = 0; i < 400; i++) {
  const l = pick(locales, i * 7);
  const c = pick(cals, i * 3);
  const nu = pick(nus, i * 5);
  const z = pick(zones, i * 11);
  const zn = pick(names, i);
  const hc = pick(hcs, i * 13);
  show(() => d.toLocaleString(l, { calendar: c, numberingSystem: nu, timeZone: z, timeZoneName: zn as Intl.DateTimeFormatOptions["timeZoneName"], hourCycle: hc as Intl.DateTimeFormatOptions["hourCycle"], hour: "numeric", minute: "numeric", year: "numeric", month: "short", day: "numeric" }));
  show(() => d.toLocaleDateString(l, { calendar: c, dateStyle: "full", timeZone: z }));
  show(() => d.toLocaleTimeString(l, { numberingSystem: nu, timeStyle: i % 2 === 0 ? "full" : "long", timeZone: z, hourCycle: hc as Intl.DateTimeFormatOptions["hourCycle"] }));
}
const bad: string[] = ["xx-invalid-tag-", "e", "en-US-u-", "123", "en_US"];
for (const b of bad) show(() => d.toLocaleString(b, { timeZone: "UTC" }));
const badCal: string[] = ["bogus", "", "gregory-x", "ISLAMIC", "iso8601", "Gregory"];
for (const c of badCal) show(() => d.toLocaleString("en", { calendar: c, timeZone: "UTC" }));
const badNu: string[] = ["bogus", "", "LATN", "roman", "hebr", "jpanyear"];
for (const n of badNu) show(() => d.toLocaleString("en", { numberingSystem: n, timeZone: "UTC" }));

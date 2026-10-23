// hourCycle and hour12 in 50 locales across the hour fields and styles, including the process-wide pattern cache V8 keeps (the first hour cycle used for a skeleton wins).
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
const locales: string[] = ["en-US","en-GB","en-AU","en-IN","en-CA","de","de-AT","de-CH","fr","fr-CA","fr-CH","es","es-MX","es-419","it","pt-BR","pt-PT","nl","sv","da","nb","fi","pl","cs","hu","ro","bg","uk","ru","tr","el","he","ar","ar-SA","fa","hi","bn","ta","th","vi","id","ms","ko","ja","zh","zh-TW","zh-HK","sw","am"];
const hcs: ("h11" | "h12" | "h23" | "h24")[] = ["h11", "h12", "h23", "h24"];
const d = new Date(1700000000123);
const n = new Date(1719792000000);
for (const l of locales) {
  for (const hc of hcs) {
    show(() => d.toLocaleTimeString(l, { hour: "numeric", hourCycle: hc, timeZone: "UTC" }));
    show(() => d.toLocaleTimeString(l, { hour: "2-digit", minute: "2-digit", hourCycle: hc, timeZone: "UTC" }));
    show(() => n.toLocaleTimeString(l, { hour: "numeric", minute: "numeric", second: "numeric", hourCycle: hc, timeZone: "UTC" }));
    show(() => n.toLocaleString(l, { timeStyle: "short", hourCycle: hc, timeZone: "UTC" }));
    show(() => n.toLocaleString(l, { dateStyle: "short", timeStyle: "medium", hourCycle: hc, timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { hour: "numeric", dayPeriod: "long", hourCycle: hc, timeZone: "UTC" }));
  }
  show(() => d.toLocaleTimeString(l, { hour12: true, timeZone: "UTC" }));
  show(() => d.toLocaleTimeString(l, { hour12: false, timeZone: "UTC" }));
  show(() => n.toLocaleTimeString(l, { hour12: false, timeZone: "UTC" }));
  show(() => n.toLocaleTimeString(l, { hour: "numeric", hour12: true, hourCycle: "h23", timeZone: "UTC" }));
  show(() => n.toLocaleString(l, { dateStyle: "short", timeStyle: "short", hour12: false, timeZone: "UTC" }));
}

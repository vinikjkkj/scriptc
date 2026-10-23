// toLocaleString / toLocaleDateString / toLocaleTimeString with dateStyle and timeStyle in 50 locales, and the Intl.DateTimeFormat twin.
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
const instants: number[] = [0,1700000000123,1709208000000,1719835230000,946684799999];
const styles: ("full" | "long" | "medium" | "short")[] = ["full", "long", "medium", "short"];
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    for (const ds of styles) {
      show(() => d.toLocaleDateString(l, { dateStyle: ds, timeZone: "UTC" }));
      show(() => d.toLocaleTimeString(l, { timeStyle: ds, timeZone: "UTC" }));
      show(() => d.toLocaleString(l, { dateStyle: ds, timeStyle: ds === "full" ? "short" : ds, timeZone: "UTC" }));
      show(() => new Intl.DateTimeFormat(l, { dateStyle: ds, timeZone: "UTC" }).format(d));
    }
    show(() => d.toLocaleString(l, { timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { timeZone: "UTC" }));
    show(() => d.toLocaleTimeString(l, { timeZone: "UTC" }));
  }
}

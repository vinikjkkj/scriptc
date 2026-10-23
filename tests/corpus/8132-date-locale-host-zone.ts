// No timeZone option: the host zone (TZ) formats, including its names, with locales and options; run under six different TZ values.
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
const locales: string[] = ["en-US","en-GB","de","fr","ja","ar","hi","th","ru","he"];
const instants: number[] = [0,1700000000123,1709208000000,1719835230000,1735732799000,951782400000];
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleString(l));
    show(() => d.toLocaleString(l, { dateStyle: "full", timeStyle: "full" }));
    show(() => d.toLocaleTimeString(l, { timeZoneName: "short" }));
    show(() => d.toLocaleTimeString(l, { timeZoneName: "longGeneric" }));
    show(() => d.toLocaleDateString(l, { timeZoneName: "longOffset", month: "long", day: "numeric" }));
  }
}

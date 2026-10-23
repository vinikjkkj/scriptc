// Instants at the edges of the representable range and across era boundaries in several calendars and zones: proleptic Gregorian years, BCE eras, the Japanese era table, leap days and DST transitions.
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
const instants: number[] = [-8640000000000000,-8639999999999999,-62198755200000,-62135596800001,-62135596800000,-2208988800000,-2209075200000,-12219292800000,-11644473600000,-1000000000000,-1,0,1,951782400000,1078012800000,1583020800000,1582934400000,1616926800000,1635638400000,4102444799999,32503680000000,253402300799999,8640000000000000];
const locales: string[] = ["en-US","de","ja","ar","he","fa","th","zh"];
const cals: string[] = ["gregory", "japanese", "buddhist", "roc", "persian", "hebrew", "islamic-civil", "chinese", "coptic", "ethiopic", "indian", "iso8601"];
const zones: string[] = ["UTC", "America/New_York", "Asia/Kolkata", "Pacific/Apia", "Europe/London"];
for (const t of instants) {
  const d = new Date(t);
  for (const l of locales) {
    for (const c of cals) {
      show(() => d.toLocaleString(l, { calendar: c, era: "short", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric", timeZone: "UTC" }));
    }
    for (const z of zones) show(() => d.toLocaleString(l, { dateStyle: "full", timeStyle: "full", timeZone: z }));
  }
}

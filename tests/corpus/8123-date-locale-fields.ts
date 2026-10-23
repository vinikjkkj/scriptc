// Field options (weekday, era, year, month, day, hour, minute, second, fractional seconds, day period) in 50 locales: the pattern generator's best match and field-width adjustment.
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
const sets: Intl.DateTimeFormatOptions[] = [
  { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  { weekday: "short", year: "numeric", month: "short", day: "numeric" },
  { year: "2-digit", month: "2-digit", day: "2-digit" },
  { year: "numeric", month: "narrow" },
  { month: "long", day: "numeric" },
  { month: "short" },
  { year: "numeric" },
  { weekday: "narrow" },
  { hour: "numeric", minute: "2-digit" },
  { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  { hour: "numeric", minute: "numeric", second: "numeric", fractionalSecondDigits: 3 },
  { minute: "numeric", second: "numeric", fractionalSecondDigits: 2 },
  { hour: "numeric", dayPeriod: "long" },
  { hour: "numeric", minute: "numeric", dayPeriod: "short" },
  { dayPeriod: "narrow" },
  { era: "short", year: "numeric" },
  { era: "long", year: "numeric", month: "long", day: "numeric" },
  { era: "narrow" },
  { weekday: "short", hour: "numeric" },
  { month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" },
  { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" },
];
const instants: number[] = [0,1700000000123,1719835230000,-62198755200000];
for (const l of locales) {
  for (const o of sets) {
    for (const t of instants) {
      const d = new Date(t);
      show(() => d.toLocaleString(l, { ...o, timeZone: "UTC" }));
    }
    show(() => new Date(1700000000123).toLocaleDateString(l, { ...o, timeZone: "UTC" }));
    show(() => new Date(1700000000123).toLocaleTimeString(l, { ...o, timeZone: "UTC" }));
  }
}

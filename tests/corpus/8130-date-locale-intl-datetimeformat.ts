// The composed new Intl.DateTimeFormat(locales, options).format(x): a Date, a number or nothing (now), the callable spelling, and the errors of an invalid time value and a bad option.
// Compared byte-for-byte with node (ICU 78.2 / CLDR 48 locale data): every line is the formatter's answer for one
// locale x options x instant; a throw prints its name and message (V8's own).
const d = new Date(1700000000123);
console.log(new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(d));
console.log(new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeZone: "Europe/Berlin" }).format(1700000000123));
console.log(Intl.DateTimeFormat("fr", { month: "long", timeZone: "UTC" }).format(d));
console.log(new Intl.DateTimeFormat("ja-JP-u-ca-japanese", { dateStyle: "long", timeZone: "UTC" }).format(d));
console.log(typeof new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format().length);
console.log(new Intl.DateTimeFormat("en", { timeZone: "UTC", year: "numeric" }).format(8.64e15));
show(() => new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(8.64e15 + 1));
show(() => new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(NaN));
show(() => new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(new Date(NaN)));
show(() => new Intl.DateTimeFormat("en", { timeZone: "Nowhere/City" }).format(d));
show(() => new Intl.DateTimeFormat("en", { dateStyle: "short", year: "numeric" }).format(d));
show(() => new Intl.DateTimeFormat("en", { timeStyle: "short", hour: "numeric" }).format(d));
show(() => new Intl.DateTimeFormat("en", { fractionalSecondDigits: 4 as 1 }).format(d));
show(() => new Intl.DateTimeFormat("en", { hour: "bogus" as "numeric" }).format(d));
show(() => new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC", timeZoneName: "bogus" as "short" }).format(d));
show(() => new Intl.DateTimeFormat("en", { localeMatcher: "bogus" as "lookup" }).format(d));
show(() => new Intl.DateTimeFormat("en", { formatMatcher: "bogus" as "basic" }).format(d));
show(() => new Intl.DateTimeFormat("en", { dateStyle: "bogus" as "short" }).format(d));
function show(f: () => string): void {
  try {
    console.log(f());
  } catch (e) {
    const x = e as Error;
    console.log(x.name + ": " + x.message);
  }
}

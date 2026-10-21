// Date.prototype.toLocale{,Date,Time}String with locale and options (en-US), compared byte-for-byte with node under
// several zones. Generated from scripts/gen-date-intl.mjs's vector space: the idioms first, then seeded random
// option vectors, then every dateStyle/timeStyle pair. Each option set runs over the instants below through all
// three methods; a throw prints its name and message (the messages are V8's).
const instants: number[] = [0, 1792587600000, 1773446400000, 1792540800000, 1792584000000, 1792584001000, 946684799999, -62198755200000, -2208988800000, 4102444799999, 253402300799999, 8640000000000000, 1805000000000, 1776000000000];
function show(f: () => string): void {
  try {
    console.log(f());
  } catch (e) {
    const x = e as Error;
    console.log(x.name + ": " + x.message);
  }
}
const sets: Intl.DateTimeFormatOptions[] = [
  {  },
  { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  { year: "numeric", month: "short", day: "numeric" },
  { month: "2-digit", day: "2-digit", year: "numeric" },
  { hour: "2-digit", minute: "2-digit" },
  { hour: "2-digit", minute: "2-digit", hour12: false },
  { hour: "numeric", minute: "numeric", second: "numeric", hour12: true },
  { timeZoneName: "short" },
  { dateStyle: "full", timeStyle: "full" },
  { dateStyle: "long", timeStyle: "short" },
  { dateStyle: "medium" },
  { timeStyle: "medium", hour12: false },
  { dateStyle: "short", timeStyle: "long", hourCycle: "h23" },
  { hour: "numeric", dayPeriod: "long" },
  { era: "short", year: "numeric" },
  { fractionalSecondDigits: 3, second: "numeric", minute: "numeric" },
  { year: "2-digit", day: "numeric", dayPeriod: "long", timeZone: "Pacific/Apia" },
  { year: "2-digit", timeZoneName: "long" },
  { month: "numeric", second: "2-digit", timeZoneName: "shortOffset" },
  { weekday: "short", month: "2-digit", timeZone: "Australia/Lord_Howe" },
  { weekday: "long", year: "2-digit", day: "2-digit", dayPeriod: "narrow", hour: "2-digit", second: "2-digit", fractionalSecondDigits: 1, timeZone: "Australia/Lord_Howe" },
  { weekday: "narrow", second: "2-digit", timeZone: "Asia/Kolkata" },
  { weekday: "narrow", month: "numeric", dayPeriod: "short", hour: "numeric", second: "2-digit", fractionalSecondDigits: 3, timeZone: "Europe/London" },
  { weekday: "narrow", year: "2-digit", day: "numeric", second: "2-digit", timeZoneName: "longGeneric", hour12: false },
  { weekday: "long", era: "narrow", month: "narrow", minute: "numeric", second: "numeric", hourCycle: "h11" },
  { month: "short", day: "2-digit", second: "numeric", timeZone: "Europe/Moscow" },
  { weekday: "long", era: "long", dayPeriod: "narrow", minute: "numeric", second: "numeric", timeZone: "America/New_York" },
  { month: "short", day: "2-digit", dayPeriod: "long", minute: "numeric", second: "numeric", fractionalSecondDigits: 1 },
  { hour: "2-digit", second: "numeric", fractionalSecondDigits: 3, timeZone: "Europe/Moscow" },
  { weekday: "narrow", second: "2-digit", timeZoneName: "short", hourCycle: "h23" },
  { month: "narrow", dayPeriod: "long", hour: "2-digit", second: "numeric", hour12: false, timeZone: "America/Sao_Paulo" },
  { weekday: "long", era: "short", dayPeriod: "narrow", fractionalSecondDigits: 2, timeZone: "Pacific/Apia" },
  { year: "2-digit", day: "numeric", dayPeriod: "narrow", hour: "2-digit", hourCycle: "h12", timeZone: "Pacific/Apia" },
  { weekday: "long", era: "narrow", year: "numeric", minute: "2-digit", second: "2-digit" },
  { era: "narrow", month: "narrow", day: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Australia/Lord_Howe" },
  { era: "narrow", year: "numeric", month: "2-digit", dayPeriod: "narrow", minute: "numeric", timeZoneName: "short", hourCycle: "h23" },
  { minute: "numeric", second: "2-digit", timeZoneName: "long", timeZone: "America/Sao_Paulo" },
  { era: "short", day: "2-digit", fractionalSecondDigits: 2, hour12: false },
  { dayPeriod: "short", minute: "numeric", second: "numeric", timeZone: "Europe/Moscow" },
  { era: "narrow", dayPeriod: "narrow", hour: "numeric", minute: "2-digit", fractionalSecondDigits: 3 },
  { weekday: "narrow", day: "numeric", dayPeriod: "narrow", minute: "2-digit", second: "numeric", timeZoneName: "shortOffset" },
  { weekday: "short", dayPeriod: "long", timeZone: "America/St_Johns" },
  { weekday: "long", day: "2-digit", fractionalSecondDigits: 2, timeZoneName: "shortOffset", hour12: true, timeZone: "Europe/Moscow" },
  { weekday: "long", year: "2-digit", month: "2-digit", day: "numeric", dayPeriod: "narrow", minute: "numeric" },
  { weekday: "short", day: "numeric", second: "numeric", fractionalSecondDigits: 3, hour12: true, timeZone: "America/St_Johns" },
  { year: "2-digit", month: "2-digit", day: "2-digit", second: "2-digit", timeZone: "America/New_York" },
  { era: "narrow", year: "numeric", fractionalSecondDigits: 3, hourCycle: "h24" },
  { weekday: "narrow", month: "numeric", dayPeriod: "short" },
  { era: "short", day: "2-digit", dayPeriod: "short", minute: "numeric", timeZone: "Africa/Casablanca" },
  { day: "numeric", hour: "2-digit", minute: "numeric", fractionalSecondDigits: 1, hour12: true, timeZone: "Europe/Moscow" },
  { weekday: "narrow", era: "long", day: "2-digit", hour: "2-digit", fractionalSecondDigits: 1, timeZone: "Pacific/Apia" },
  { day: "numeric", dayPeriod: "long", hourCycle: "h23" },
  { weekday: "short", year: "numeric", hour: "numeric", fractionalSecondDigits: 1, timeZoneName: "shortGeneric", hourCycle: "h11", timeZone: "UTC" },
  { month: "narrow", day: "numeric", dayPeriod: "narrow", fractionalSecondDigits: 3, timeZoneName: "short", timeZone: "America/Sao_Paulo" },
  { era: "short", month: "short", dayPeriod: "long", second: "numeric", fractionalSecondDigits: 2, timeZoneName: "longGeneric" },
  { year: "numeric", day: "numeric", dayPeriod: "short" },
  { weekday: "short", hour: "2-digit", second: "numeric", timeZone: "America/New_York" },
  { era: "long", year: "numeric", day: "2-digit", hour: "numeric", timeZone: "America/Sao_Paulo" },
  { era: "long", day: "numeric", second: "2-digit", timeZone: "Asia/Kathmandu" },
  { day: "2-digit", dayPeriod: "long", hour: "numeric", second: "2-digit", hourCycle: "h11" },
  { day: "numeric", hour: "2-digit", second: "2-digit", hourCycle: "h11", timeZone: "Africa/Casablanca" },
  { era: "short", hour: "numeric", minute: "numeric", timeZoneName: "long", timeZone: "Asia/Kathmandu" },
  { era: "long" },
  { weekday: "narrow", era: "long", day: "2-digit", dayPeriod: "long", fractionalSecondDigits: 3, timeZoneName: "shortGeneric", timeZone: "Australia/Lord_Howe" },
  { weekday: "long", era: "short", year: "2-digit", hour: "numeric", minute: "2-digit", timeZone: "Europe/London" },
  { year: "numeric", day: "numeric", dayPeriod: "short", hourCycle: "h23", timeZone: "America/St_Johns" },
  { month: "narrow", dayPeriod: "long", fractionalSecondDigits: 2, timeZone: "Australia/Lord_Howe" },
  { weekday: "short", year: "2-digit", month: "narrow", day: "numeric", hour: "2-digit", second: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" },
  { month: "2-digit", day: "2-digit", hour: "numeric", timeZoneName: "longGeneric", hourCycle: "h23" },
  { minute: "2-digit", fractionalSecondDigits: 1, timeZoneName: "short", hour12: false, timeZone: "America/New_York" },
  { era: "short", timeZoneName: "shortGeneric", hourCycle: "h24", timeZone: "Asia/Kathmandu" },
  { dayPeriod: "long", hour: "numeric", minute: "numeric", second: "numeric", timeZone: "America/Sao_Paulo" },
  { era: "long", year: "2-digit", dayPeriod: "short", minute: "2-digit", second: "numeric", timeZone: "America/Sao_Paulo" },
  { weekday: "short", era: "short", year: "2-digit", month: "numeric", dayPeriod: "long", second: "numeric", hour12: false },
  { era: "long", year: "2-digit", dayPeriod: "long", hour12: true, timeZone: "America/Sao_Paulo" },
  { year: "numeric", month: "short", day: "numeric", second: "numeric" },
  { month: "long", dayPeriod: "narrow", minute: "2-digit" },
  { month: "numeric", hour: "numeric", minute: "numeric", fractionalSecondDigits: 1, timeZone: "Europe/London" },
  { weekday: "short", day: "numeric", minute: "2-digit", hour12: true },
  { era: "narrow", minute: "2-digit", second: "numeric", timeZoneName: "longOffset" },
  { year: "2-digit", second: "2-digit", fractionalSecondDigits: 2, timeZone: "America/St_Johns" },
  { weekday: "long", era: "long", dayPeriod: "short", minute: "2-digit", timeZoneName: "long", hourCycle: "h11", timeZone: "America/Sao_Paulo" },
  { era: "long", month: "short", dayPeriod: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" },
  { weekday: "short", month: "narrow", hour: "2-digit", timeZone: "Africa/Casablanca" },
  { era: "short", month: "numeric", day: "numeric", dayPeriod: "short", minute: "numeric" },
  { day: "numeric", hour: "numeric", fractionalSecondDigits: 2, hourCycle: "h24" },
  { timeStyle: "full", timeZone: "Pacific/Apia", hourCycle: "h23" },
  { timeStyle: "long", timeZone: "Europe/Moscow" },
  { timeStyle: "medium", timeZone: "America/St_Johns", hourCycle: "h12" },
  { timeStyle: "short", timeZone: "Asia/Kathmandu" },
  { dateStyle: "full", timeZone: "UTC" },
  { dateStyle: "full", timeStyle: "full", timeZone: "Europe/Moscow" },
  { dateStyle: "full", timeStyle: "long", timeZone: "Europe/Moscow", hourCycle: "h11" },
  { dateStyle: "full", timeStyle: "medium", timeZone: "America/New_York" },
  { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Moscow" },
  { dateStyle: "long", timeZone: "Asia/Kathmandu" },
  { dateStyle: "long", timeStyle: "full", timeZone: "Europe/Moscow" },
  { dateStyle: "long", timeStyle: "long", timeZone: "Asia/Kolkata", hourCycle: "h12" },
  { dateStyle: "long", timeStyle: "medium", timeZone: "Asia/Kolkata", hourCycle: "h24" },
  { dateStyle: "long", timeStyle: "short", timeZone: "America/Sao_Paulo", hourCycle: "h12" },
  { dateStyle: "medium", timeZone: "Europe/London" },
  { dateStyle: "medium", timeStyle: "full", timeZone: "Australia/Lord_Howe" },
  { dateStyle: "medium", timeStyle: "long", timeZone: "Pacific/Chatham", hourCycle: "h23" },
  { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Moscow", hourCycle: "h12" },
  { dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Chatham", hourCycle: "h11" },
  { dateStyle: "short", timeZone: "Pacific/Chatham" },
  { dateStyle: "short", timeStyle: "full", timeZone: "Asia/Kathmandu" },
  { dateStyle: "short", timeStyle: "long", timeZone: "America/New_York" },
  { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" },
  { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" },
];
for (let i = 0; i < sets.length; i++) {
  const o = sets[i]!;
  console.log("#" + i);
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleString("en-US", o));
    show(() => d.toLocaleDateString("en-US", o));
    show(() => d.toLocaleTimeString(undefined, o));
  }
}
// literal object arguments (the static path) and the error paths
const d0 = new Date(1792587600000);
show(() => d0.toLocaleString("en-US", { month: "long", day: "numeric" }));
show(() => d0.toLocaleString("en", { hour12: false, timeZone: "UTC" }));
show(() => d0.toLocaleDateString("en-US", { timeStyle: "short" }));
show(() => d0.toLocaleTimeString("en-US", { dateStyle: "short" }));
show(() => d0.toLocaleString("en-US", { dateStyle: "short", month: "long" }));
show(() => d0.toLocaleString("en-US", { timeZone: "Not/AZone" }));
show(() => d0.toLocaleString("en-US", { timeZone: "america/new_york", timeZoneName: "long" }));
show(() => d0.toLocaleString("en-US", { timeZone: "+05:30", timeZoneName: "short" }));
show(() => d0.toLocaleString("en-US", { timeZone: "-0800", timeZoneName: "longOffset" }));
show(() => new Date(NaN).toLocaleString("en-US", { month: "long" }));
show(() => d0.toLocaleString("en-US", { fractionalSecondDigits: 3, hour: "numeric", minute: "numeric", second: "numeric", timeZone: "UTC" }));
const tzv = "Asia/Tokyo";
const hv: boolean | undefined = process.argv.length > 99 ? true : undefined;
show(() => d0.toLocaleString("en-US", { timeZone: tzv, hour12: hv }));
show(() => d0.toLocaleString("en-US", { timeZone: tzv, hour12: hv, hour: "numeric" }));

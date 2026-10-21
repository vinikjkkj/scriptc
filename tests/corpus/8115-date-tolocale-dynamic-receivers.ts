// toLocale{,Date,Time}String through the checked-dynamic Date handle (an `any` receiver, a cast out of `unknown`),
// with and without locale and options, and the shared name `toLocaleString` on the other dynamic kinds.
const d = new Date(1792587600000);
const a: any = d;
console.log(a.toLocaleString());
console.log(a.toLocaleString("en-US", { timeZone: "UTC", month: "long" }));
console.log(a.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Tokyo" }));
console.log(a.toLocaleTimeString("en-US", { hour12: false, timeZone: "UTC" }));
console.log(a.toLocaleDateString());
console.log(a.toLocaleTimeString());
const u: unknown = d;
console.log((u as Date).toLocaleString("en-US", { timeZone: "Pacific/Chatham", timeZoneName: "short" }));
const s: any = "abc";
console.log(s.toLocaleString());
const b: any = true;
console.log(b.toLocaleString());
function attempt(f: () => string): void {
  try {
    console.log(f());
  } catch (e) {
    console.log((e as Error).name + ": " + (e as Error).message);
  }
}
attempt(() => a.toLocaleString("en-US", { month: "xx" }));
attempt(() => a.toLocaleString("en-US", { timeZone: "Nope/Zone" }));
attempt(() => a.toLocaleDateString("en-US", { timeStyle: "short" }));
attempt(() => a.toLocaleString("en-US", { dateStyle: "short", hour: "numeric" }));
const o: any = { hour: "numeric", hour12: false, timeZone: "UTC", minute: "2-digit" };
console.log(a.toLocaleString("en-US", o));
console.log(a.toLocaleString(undefined, undefined));
console.log(a.toLocaleString("en", { timeZone: "UTC" }), a.toLocaleString(["en-US"], { timeZone: "UTC" }));
const f3: any = { fractionalSecondDigits: 3, second: "numeric", minute: "numeric", timeZone: "UTC" };
console.log(a.toLocaleString("en-US", f3));
const bad: any = { fractionalSecondDigits: 7, timeZone: "UTC" };
attempt(() => a.toLocaleString("en-US", bad));

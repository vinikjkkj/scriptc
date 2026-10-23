// timeZoneName in every style (short, long, shortOffset, longOffset, shortGeneric, longGeneric) and the full/long timeStyles over 32 zones and 24 locales: the metazone history, generic and partial-location names, the exemplar cities and the localized GMT formats.
// Compared byte-for-byte with node (ICU 78.2 / CLDR 48 locale data): every line is the formatter's answer for one
// locale x options x instant; a throw prints its name and message (V8's own).
const lines: string[] = [];
function show(f: () => string): void {
  try {
    lines.push(f());
  } catch (e) {
    const x = e as Error;
    lines.push(x.name + ": " + x.message);
  }
}
// FNV-1a over UTF-16 code units: the output stays under the harness's 1 MiB pipe, and every line of every
// group is still compared byte-for-byte through its group hash. The instant at index 1 also prints in full.
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const zones: string[] = ["UTC","America/New_York","America/Los_Angeles","America/Sao_Paulo","America/St_Johns","America/Argentina/Buenos_Aires","Europe/London","Europe/Dublin","Europe/Berlin","Europe/Moscow","Africa/Cairo","Africa/Casablanca","Asia/Tokyo","Asia/Kolkata","Asia/Calcutta","Asia/Kathmandu","Asia/Tehran","Asia/Pyongyang","Australia/Sydney","Australia/Lord_Howe","Pacific/Chatham","Pacific/Apia","Pacific/Kiritimati","Antarctica/Troll","Etc/GMT+5","Etc/GMT-14","US/Pacific","+05:30","-03:00","+00:00","GMT","Etc/UTC"];
const locales: string[] = ["en-US","en-GB","de","fr","es","it","pt","ru","ar","fa","he","hi","th","ja","zh","zh-TW","ko","tr","pl","id","sv","bn","sw","am"];
const names: ("short" | "long" | "shortOffset" | "longOffset" | "shortGeneric" | "longGeneric")[] = ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"];
const instants: number[] = [0,1700000000123,1719835230000,1709208000000,946684799999,1735732799000];
for (const l of locales) {
  for (const z of zones) {
    for (let ti = 0; ti < instants.length; ti++) {
      const t = instants[ti]!;
      const d = new Date(t);
      lines.length = 0;
      for (const n of names) show(() => d.toLocaleString(l, { hour: "numeric", minute: "numeric", timeZone: z, timeZoneName: n }));
      show(() => d.toLocaleString(l, { dateStyle: "full", timeStyle: "full", timeZone: z }));
      show(() => d.toLocaleTimeString(l, { timeStyle: "long", timeZone: z }));
      console.log(l + " " + z + " " + t + " " + lines.length + " " + fnv(lines.join("\n")));
      if (ti === 1) for (const x of lines) console.log(x);
    }
  }
}

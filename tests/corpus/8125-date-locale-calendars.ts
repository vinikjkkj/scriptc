// Every calendar Intl.DateTimeFormat has (gregory, buddhist, chinese, coptic, dangi, ethioaa, ethiopic, hebrew, indian, islamic*, iso8601, japanese, persian, roc) as a literal option and through the -u-ca- extension.
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
const locales: string[] = ["en-US","en-GB","de","fr","ar","fa","he","hi","th","ja","zh","zh-TW","ko","ru","tr","id","vi","sv"];
const instants: number[] = [0,1700000000123,1709208000000,1719835230000,-62198755200000,4102444799999];
show(() => new Date(1700000000123).toLocaleDateString("en", { calendar: "gregory", dateStyle: "full", timeZone: "UTC" }));
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "gregory", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "gregory", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "gregory", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "gregory", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "buddhist", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "buddhist", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "buddhist", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "buddhist", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "chinese", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "chinese", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "chinese", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "chinese", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "coptic", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "coptic", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "coptic", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "coptic", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "dangi", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "dangi", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "dangi", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "dangi", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "ethioaa", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "ethioaa", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "ethioaa", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "ethioaa", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "ethiopic", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "ethiopic", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "ethiopic", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "ethiopic", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "hebrew", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "hebrew", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "hebrew", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "hebrew", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "indian", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "indian", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "indian", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "indian", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "islamic", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "islamic", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "islamic", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "islamic", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "islamic-civil", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "islamic-civil", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "islamic-civil", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "islamic-civil", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "islamic-rgsa", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "islamic-rgsa", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "islamic-rgsa", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "islamic-rgsa", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "islamic-tbla", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "islamic-tbla", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "islamic-tbla", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "islamic-tbla", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "islamic-umalqura", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "islamic-umalqura", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "islamic-umalqura", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "islamic-umalqura", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "iso8601", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "iso8601", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "iso8601", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "iso8601", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "japanese", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "japanese", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "japanese", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "japanese", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "persian", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "persian", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "persian", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "persian", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}
for (const l of locales) {
  for (const t of instants) {
    const d = new Date(t);
    show(() => d.toLocaleDateString(l, { calendar: "roc", dateStyle: "full", timeZone: "UTC" }));
    show(() => d.toLocaleString(l, { calendar: "roc", dateStyle: "short", timeStyle: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l, { calendar: "roc", year: "numeric", month: "long", day: "numeric", era: "short", timeZone: "UTC" }));
    show(() => d.toLocaleDateString(l + "-u-ca-" + "roc", { month: "narrow", day: "numeric", weekday: "long", year: "2-digit", timeZone: "UTC" }));
  }
}

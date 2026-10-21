// toLocale*String: the one bundled locale is en-US, so every other locale, a locale the compiler cannot read,
// a calendar or numbering system other than the default, and several locales are build-time refusals that name
// what is missing (a deferred runtime throw would be a defect).
const d = new Date(0);
const l: string = "de-DE";
console.log(d.toLocaleString("de-DE"));
console.log(d.toLocaleDateString(l));
console.log(d.toLocaleTimeString("en-US", { calendar: "buddhist" }));
console.log(d.toLocaleString("en-US", { numberingSystem: "arab" }));
console.log(d.toLocaleString(["en-US", "de"]));

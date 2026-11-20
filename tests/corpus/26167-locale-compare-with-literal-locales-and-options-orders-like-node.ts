// localeCompare(that, locales, options) and new Intl.Collator(locales, options).compare with literal locales and options: sensitivity, caseFirst, numeric, ignorePunctuation, root-equivalent languages, -u-kn / -u-kf keys.
const words = ["resume", "Resume", "résumé", "résume", "RESUME", "a", "A", "á", "Á", "b", "B", "a1", "a2", "a10", "a-b", "ab", "a b", "ä", "z", "Z", "10", "9", "1a", "_a", "ß", "ss", ""];
const out = (name: string, f: (a: string, b: string) => number): void => {
  const sorted = words.slice().sort(f);
  let sig = "";
  for (let i = 0; i < words.length; i++) for (let j = 0; j < words.length; j += 3) sig += f(words[i]!, words[j]!) < 0 ? "<" : f(words[i]!, words[j]!) > 0 ? ">" : "=";
  console.log(name, JSON.stringify(sorted), sig.length, sig.split("<").length, sig.split(">").length, sig.split("=").length);
};
out("default", (a, b) => a.localeCompare(b));
out("en", (a, b) => a.localeCompare(b, "en"));
out("en-US", (a, b) => a.localeCompare(b, "en-US", {}));
out("fr", (a, b) => a.localeCompare(b, ["fr"]));
out("base", (a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
out("accent", (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }));
out("case", (a, b) => a.localeCompare(b, "en", { sensitivity: "case" }));
out("variant", (a, b) => a.localeCompare(b, "de", { sensitivity: "variant" }));
out("upper", (a, b) => a.localeCompare(b, "en", { caseFirst: "upper" }));
out("lower", (a, b) => a.localeCompare(b, "en", { caseFirst: "lower" }));
out("numeric", (a, b) => a.localeCompare(b, "en", { numeric: true }));
out("punct", (a, b) => a.localeCompare(b, "en", { ignorePunctuation: true }));
out("numeric+upper", (a, b) => a.localeCompare(b, "en", { numeric: true, caseFirst: "upper", sensitivity: "variant" }));
out("kn", (a, b) => a.localeCompare(b, "en-u-kn"));
out("kn-false+opt", (a, b) => a.localeCompare(b, "en-u-kn-false", { numeric: true }));
out("kf", (a, b) => a.localeCompare(b, "en-u-kf-upper"));
out("kf+opt", (a, b) => a.localeCompare(b, "en-u-kf-upper", { caseFirst: "lower" }));
out("base+punct", (a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", ignorePunctuation: true, usage: "sort" }));
out("composed", (a, b) => new Intl.Collator("en", { numeric: true }).compare(a, b));
out("composed-default", (a, b) => new Intl.Collator().compare(a, b));

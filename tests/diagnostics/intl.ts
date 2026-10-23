// The Intl surface. What lowers: number and bigint toLocaleString and the
// COMPOSED new Intl.NumberFormat(locales, options).format(x), for every ICU
// locale, option and numbering system, and Date toLocale*String and the composed
// new Intl.DateTimeFormat(locales, options).format(x) likewise. What fences by
// NAME: formatter VALUES (a hoisted Intl.NumberFormat or Intl.DateTimeFormat has
// no representation yet) and the rest of the Intl namespace (DurationFormat,
// PluralRules, getCanonicalLocales).

const hoisted = new Intl.NumberFormat("en-US");
const viaValue = hoisted.format(1234.5);

// The rest of Intl keeps the ICU story.
const hoistedDate = new Intl.DateTimeFormat("en-US");
const when = hoistedDate.format(0);
const dur = new Intl.DurationFormat("en-US").format({ hours: 1, minutes: 23 });
const rule = new Intl.PluralRules("en-US").select(1);
const canon = Intl.getCanonicalLocales("en-us");

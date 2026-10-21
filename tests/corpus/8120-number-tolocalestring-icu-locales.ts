const n = 1234567.891;
console.log(n.toLocaleString("en-US"), n.toLocaleString("de-DE"), n.toLocaleString("en-US", { style: "currency", currency: "EUR" }));
console.log(n.toLocaleString("ja-JP", { notation: "compact" }), n.toLocaleString("hi-IN"), (0.256).toLocaleString("fr", { style: "percent", minimumFractionDigits: 1 }));
console.log(new Intl.NumberFormat("de-CH", { style: "unit", unit: "kilometer-per-hour", unitDisplay: "long" }).format(88.5));
console.log((12345678901234567890n).toLocaleString("en-IN"));
console.log(n.toLocaleString(), n.toLocaleString(undefined, { maximumFractionDigits: 0 }));
try { n.toLocaleString("en-US", { style: "currency" }); } catch (e) { console.log((e as Error).name, (e as Error).message); }
for (const loc of ["ar-EG", "fa", "bn", "th-TH-u-nu-thai", "sv", "pt-PT", "zh-Hant-TW", "sr-Cyrl-ME", "en-IN", "es-419"]) {
  console.log(loc, (-1234567.891).toLocaleString(loc), (0.5).toLocaleString(loc, { style: "percent" }), (1e21).toLocaleString(loc, { notation: "compact", compactDisplay: "long" }));
}
console.log((1234.5).toLocaleString("en", { style: "currency", currency: "JPY", currencyDisplay: "name" }));
console.log((1234.5).toLocaleString("de", { style: "currency", currency: "EUR", currencySign: "accounting", signDisplay: "exceptZero" }));
console.log((0.000123).toLocaleString("en", { notation: "scientific", maximumSignificantDigits: 2 }), (123456).toLocaleString("en", { notation: "engineering" }));
console.log((1.005).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingMode: "halfEven", roundingIncrement: 5 }));

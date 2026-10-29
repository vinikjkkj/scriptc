// Date.parse of ECMA date-only forms: UTC, whatever the year and month digits.
const xs: string[] = ["2020-01-01", "2020-07", "2020", "1970-01-01", "0001-01-01", "1999-12-31"];
for (const s of xs) console.log(s, Date.parse(s));

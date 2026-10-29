// Date.parse of strings that are not dates at all, and of malformed ISO shapes.
const xs: string[] = ["bogus", "", "x", "20200101", "2020-01-01T00:00:00.000 Z", "2020-01-01T10", "T10:00Z", "   "];
for (const s of xs) console.log(JSON.stringify(s), Date.parse(s));

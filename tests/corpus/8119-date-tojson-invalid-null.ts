// Date.prototype.toJSON on an invalid Date answers null exactly as Node does: the call's result is read like any slot that
// may hold null (printing, serialising, templates, comparisons, ??, ?., conditions and a declaration keep the union;
// a property use throws the TypeError naming the property).
const ok = new Date(86400000), bad = new Date(NaN);
console.log(ok.toJSON(), bad.toJSON());
console.log(JSON.stringify(bad.toJSON()), JSON.stringify({ a: bad }));
console.log(bad.toJSON() === null, bad.toJSON() ?? "dflt", ok.toJSON() ?? "dflt", `${bad.toJSON()}`, String(bad.toJSON()));
const s = bad.toJSON();
console.log(s === null, s, typeof s);
const s2 = ok.toJSON();
console.log(s2.length, s2.slice(0, 4), typeof s2);
const s3: string = bad.toJSON();
console.log(s3);
console.log(bad.toJSON()?.length, ok.toJSON()?.length);
console.log(bad.toJSON() ? "t" : "f", bad.toJSON() || "or");
try { console.log(bad.toJSON().length); } catch (e) { console.log((e as Error).name, (e as Error).message); }
try { console.log(bad.toJSON().toUpperCase()); } catch (e) { console.log((e as Error).name, (e as Error).message); }
function take(x: string) { return x === null ? "null!" : x; }
console.log(take(ok.toJSON()));
const rec = { at: ok.toJSON() };
console.log(JSON.stringify(rec));
const u = new Date("2020-01-01T00:00:00Z");
console.log(u.toJSON(), [u.toJSON()].length);

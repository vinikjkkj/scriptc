const n: any = 1234567.891;
console.log(n.toLocaleString("de-DE"), n.toLocaleString("en-US", { style: "currency", currency: "USD" }), n.toLocaleString("ja", { notation: "compact" }));
const b: any = 12345678901234567890n;
console.log(b.toLocaleString("en-IN"), b.toLocaleString("de", { useGrouping: false }));
const a: any = [1.5, 2000.25, null, undefined, 3];
console.log(a.toLocaleString("de-DE", { minimumFractionDigits: 2 }));
console.log(a.toLocaleString());
const o: any = { style: "percent", minimumFractionDigits: 1 };
console.log((0.123456).toLocaleString("fr", o), n.toLocaleString(["xx", "de"], o), n.toLocaleString("ar-EG"));
try { n.toLocaleString("en", { style: "currency" }); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
try { n.toLocaleString("en", null); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
try { n.toLocaleString("e_n"); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
const s: any = "text", t: any = true;
console.log(s.toLocaleString("de"), t.toLocaleString("de"));

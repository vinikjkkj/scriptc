const t = "a-b".split(/(-)|(x)/);
for (let i = 0; i < t.length; i++) {
  try { console.log(i, t[i].length); } catch (e) { console.log(i, (e as Error).message); }
}
const k = 2;
try { const s = t[k]; console.log(s.length); } catch (e) { console.log((e as Error).message); }
try { const s = t[k]!; console.log(s.toUpperCase()); } catch (e) { console.log((e as Error).message); }
try { const s = t[1]; console.log(s.length); } catch (e) { console.log((e as Error).message); }

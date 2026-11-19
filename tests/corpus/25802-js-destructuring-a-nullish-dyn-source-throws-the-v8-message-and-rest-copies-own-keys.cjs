// Plain JS: object destructuring of a nullish source throws V8's "Cannot destructure property 'x' of 'a' as it is null." (spelled by the
// source text: identifier, member chain, call; by value for a parameter pattern), an empty or rest-first pattern drops the property name,
// and a rest binding over an untyped value copies the unconsumed own enumerable keys.
function bad(a) {
  try { const { x } = a; console.log(x); } catch (e) { console.log(e.message); }
  try { const { x: { y } } = a; console.log(y); } catch (e) { console.log(e.message); }
  try { const {} = a; console.log('empty ok'); } catch (e) { console.log(e.message); }
  try { const { x } = a.b; console.log(x); } catch (e) { console.log(e.message); }
  try { const { ...r } = a; console.log(r); } catch (e) { console.log(e.message); }
  try { const { x = 1, ...r } = a; console.log(x, r); } catch (e) { console.log(e.message); }
}
bad(JSON.parse('null'));
bad(JSON.parse('{"b":null}'));
bad(JSON.parse('{"b":{"x":4},"x":{"y":5},"z":6}'));
function p({ x }) { return x; }
try { console.log(p()); } catch (e) { console.log(e.message); }
try { console.log(p(JSON.parse('null'))); } catch (e) { console.log(e.message); }
console.log(p(JSON.parse('{"x":8}')));

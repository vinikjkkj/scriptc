// A parsed object cast to a struct with an optional member: later writes show through both ways, an optional member written as undefined
// disappears from the object, and the cast is the same value each time.
interface S { x: number; y?: string }
const j: any = JSON.parse('{"x":1,"y":"s","extra":true}');
const s = j as S;
console.log(s.x, s.y, JSON.stringify(s));
j.x = 9; console.log(s.x);
s.x = 11; console.log(j.x);
s.y = undefined; console.log(JSON.stringify(j));
console.log(Object.keys(s).join(","));
console.log(s);
const cp = { ...s }; console.log(cp.x, Object.keys(cp).join(","));
console.log(s === (j as S), (s as any) === j);

// a field on {a:number} | {b:string}: the arm without 'a' answers undefined
function pick(n) {
  if (n === 0) return { a: 7 };
  return { b: "z" };
}
function fa(n) {
  return pick(n).a;
}
for (let i = 0; i < 2; i++) console.log(fa(i));

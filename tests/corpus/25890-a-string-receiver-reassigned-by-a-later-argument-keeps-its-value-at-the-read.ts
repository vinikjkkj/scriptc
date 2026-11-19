// A string method reads its receiver BEFORE the arguments run: a later argument that reassigns the receiver's local must not change what the method sees (the receiver is borrowed from the local only when no later operand writes it).
function indexOfAfterWrite(): number {
  let s = "abcabc";
  return s.indexOf((s = "xyzxyz", "c"));
}
function charCodeAfterWrite(): number {
  let s = "AB";
  return s.charCodeAt((s = "ZZ", 1)) * 1000 + s.charCodeAt(0);
}
function lengthPlusWrite(): number {
  let s = "hello";
  return s.length + (s = "hi", s.length);
}
function eqAfterWrite(): boolean {
  let a = "left";
  const b = "left";
  return a === (a = "right", b);
}
function cmpAfterWrite(): boolean {
  let a = "apple";
  return a < (a = "zebra", "banana");
}
function stable(): number {
  const s = "stable-string";
  let n = 0;
  for (let i = 0; i < 2000; i++) n += s.charCodeAt(i % s.length) + s.length + s.indexOf("-");
  return n;
}
console.log(indexOfAfterWrite(), charCodeAfterWrite(), lengthPlusWrite(), eqAfterWrite(), cmpAfterWrite(), stable());

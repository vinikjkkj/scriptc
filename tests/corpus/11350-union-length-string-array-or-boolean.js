// .length on a string[] | boolean value (the union comes from a runtime-selected return)
function pick(n) {
  if (n === 0) return ["a", "bb", "ccc"];
  if (n === 1) return true;
  return false;
}
function len(n) {
  return pick(n).length;
}
for (let i = 0; i < 3; i++) console.log(len(i));

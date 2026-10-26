// .length on a string | number value: the string arm answers its length, the number arm answers undefined
function pick(n) {
  if (n === 0) return "hello";
  if (n === 1) return 42;
  return 0;
}
function len(n) {
  return pick(n).length;
}
for (let i = 0; i < 3; i++) console.log(len(i));

// .length on a unit-only union (null | undefined): always Node's TypeError, catchable
function pick(n) {
  if (n === 0) return null;
  return undefined;
}
function len(n) {
  return pick(n).length;
}
for (let i = 0; i < 2; i++) {
  try {
    console.log(len(i));
  } catch (e) {
    console.log(e.name + ": " + e.message);
  }
}

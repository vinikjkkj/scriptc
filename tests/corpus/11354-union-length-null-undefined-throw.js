// null and undefined arms: Node's TypeError text, caught and printed
function pick(n) {
  if (n === 0) return null;
  if (n === 1) return undefined;
  return "four";
}
function len(n) {
  return pick(n).length;
}
for (let i = 0; i < 3; i++) {
  try {
    console.log(len(i));
  } catch (e) {
    console.log(e.name + ": " + e.message);
  }
}

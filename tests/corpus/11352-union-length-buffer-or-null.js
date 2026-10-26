// .length on a Buffer | null value: the null arm throws Node's TypeError, the Buffer arm answers its length
function pick(n) {
  if (n === 0) return Buffer.from("abcd");
  return null;
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

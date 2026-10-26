// compound use after the read: (x.length & 0xff), with the boolean arm answering undefined (undefined & 0xff is 0)
function pick(n) {
  if (n === 0) return ["q", "w"];
  if (n === 1) return true;
  return ["0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890"];
}
function low(n) {
  return pick(n).length & 0xff;
}
for (let i = 0; i < 3; i++) console.log(low(i));

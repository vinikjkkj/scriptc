// Concat chains of 4 KB to 64 KB share one string per content; every copy must stay independent: appending to one never shows in another, equal chains are equal, different chains differ,
// at every size edge (4095/4096/4097 and 65535/65536/65537) and with the accumulator form on a shared result.
let out = [];
let h = 0;
function sum(s) { let x = 0; for (let i = 0; i < s.length; i += 61) x = (x * 31 + s.charCodeAt(i)) | 0; return x + ":" + s.length; }
function chain(total, k) { // a 4-operand chain of exactly `total` characters, content chosen by k
  const head = "H" + k + ":", tail = ":T";
  const mid = "m".repeat(total - head.length - tail.length - 5) + String(k % 7).padStart(5, "0");
  return head + mid + tail;
}
for (const total of [100, 4000, 4095, 4096, 4097, 11140, 30000, 65535, 65536, 65537, 70000]) {
  const A = [], B = [];
  for (let c = 0; c < 4; c++) {
    const head = "H" + (c % 2) + ":", tail = ":T";
    const mid = "m".repeat(total - head.length - tail.length - 5);
    const num = String((c % 2) * 3).padStart(5, "0");
    A.push(head + mid + num + tail);       // two contents, each built twice: copies 0,2 equal and 1,3 equal
  }
  out.push(total + " eq " + (A[0] === A[2]) + (A[1] === A[3]) + (A[0] === A[1]) + " len " + A[0].length + " " + sum(A[0]) + " " + sum(A[1]));
  A[0] = A[0] + "XYZ";                         // append to one copy: the others must not see it
  A[1] = A[1] + "-" + "q";
  out.push(total + " after " + A[0].length + " " + A[2].length + " " + A[3].length + " " + sum(A[2]) + " " + sum(A[3]) + " " + A[2].endsWith(":T") + A[0].endsWith("XYZ"));
  let acc = A[2] + "";                      // the accumulator form over a shared result
  for (let i = 0; i < 5; i++) acc += "." + i;
  const again = "H" + 0 + ":" + "m".repeat(total - 4 - 2 - 5) + "00000" + ":T";
  out.push(total + " acc " + acc.length + " " + (again === A[2]) + " " + again.length);
  B.push(chain(total, 1), chain(total, 1), chain(total, 2));
  out.push(total + " chain " + (B[0] === B[1]) + (B[0] === B[2]) + " " + sum(B[0]) + " " + sum(B[2]));
  h = (h * 131 + sum(B[0]).length) | 0;
}
console.log(out.join("\n"));
console.log(h);

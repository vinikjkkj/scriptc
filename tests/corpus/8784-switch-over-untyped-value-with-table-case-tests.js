"use strict";
// The RESP decoder's shape: `switch (chunk[cursor])` over an untyped byte, each case
// test a read of a const table whose keys include non-identifiers ("+", "-", "\r"),
// so the table is an untyped object and every test is a checked read, not a literal.
const ASCII = { "\r": 13, t: 116, "+": 43, "-": 45, "0": 48, ".": 46, e: 101 };

function classify(chunk, i) {
  switch (chunk[i]) {
    case ASCII["+"]:
      return "plus";
    case ASCII["-"]:
      return "minus";
    case ASCII.e:
    case ASCII["\r"]:
      return "e-or-cr";
    case ASCII["0"]:
      return "zero";
    default:
      return "other";
  }
}

// Tests run in source order and only until one matches: observable through a call.
let evaluated = [];
function probe(label, v) {
  evaluated.push(label);
  return v;
}
function ordered(x) {
  evaluated = [];
  let r;
  switch (x) {
    case probe("a", 1):
      r = "one";
      break;
    case probe("b", 2):
    case probe("c", 3):
      r = "two-or-three";
      break;
    case probe("d", 4):
      r = "four";
      break;
    default:
      r = "none";
  }
  return r + " after " + evaluated.join("");
}

const bytes = Buffer.from([43, 45, 101, 13, 48, 7]);
for (let i = 0; i < bytes.length; i++) console.log(i, classify(bytes, i));
console.log(ordered(1), "|", ordered(3), "|", ordered(4), "|", ordered(9));

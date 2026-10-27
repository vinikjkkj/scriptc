function kind(s: string): string {
  switch (s) {
    case "\uFEFF": return "bom";
    case "﻿x": return "bomx";
    default: return "other:" + s.length;
  }
}
console.log(kind("\uFEFF"), kind("﻿x"), kind(""), kind("x"));

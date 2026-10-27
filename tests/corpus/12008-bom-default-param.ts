function f(s: string = "﻿z"): number { return s.length * 10 + s.charCodeAt(0) % 256; }
console.log(f(), f(""));
const g = (s = "\uFEFF") => s.length;
console.log(g(), g("ab"));

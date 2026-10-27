const a = "x\uFEFFy";
const b = "x﻿y";
console.log(a.length, a.charCodeAt(1), b.length, b.charCodeAt(1), a === b);

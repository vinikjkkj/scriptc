const parts = ["\uFEFF", "a", "﻿b"];
const joined = parts.join("|");
console.log(joined.length, joined.charCodeAt(0), joined.split("|").length);
console.log("\uFEFFhead".startsWith("\uFEFF"), "\uFEFF".trim().length, ("﻿x").indexOf("x"));

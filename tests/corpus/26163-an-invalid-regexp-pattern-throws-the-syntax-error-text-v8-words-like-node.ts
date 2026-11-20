// new RegExp over an invalid pattern: the SyntaxError message is V8's wording (Unterminated group, Nothing to repeat, ...).
const pats = ["(", ")", "*", "[", "a{2,1}", "\\", "(?<n>a)(?<n>b)", "[b-a]", "(?", "+a", "a**", "(?<1a>x)", "\\k<x>(?<y>a)", "a{1", "?", "(?:", "[a", "x)", "\\u{110000}", "(?<n", "\\p{Foo}"];
for (const p of pats) { try { new RegExp(p); console.log("ok", p); } catch (e) { console.log(JSON.stringify(p), (e as Error).message); } }
for (const p of ["\\u{110000}", "\\p{Foo}", "[\\d-a]", "\\1(a)", "(?<n>a)\\k<m>"]) { try { new RegExp(p, "u"); console.log("ok-u", p); } catch (e) { console.log("u", JSON.stringify(p), (e as Error).message); } }

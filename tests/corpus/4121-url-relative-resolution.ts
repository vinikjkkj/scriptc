// new URL(input, base) -- the WHATWG relative resolution, over RFC 3986's
// own reference suite (section 5.4) plus the shapes that suite leaves out.
//
// The resolution builds the absolute spelling and hands it to the SAME
// parser the one-argument form uses, so dot-segment removal, percent
// encoding and the "Invalid URL" TypeError are shared rather than copied.
// Every row here is compared byte for byte against Node.
//
// The row that is easy to get wrong is "http:g": a scheme prefix normally
// means the input is absolute, but a SPECIAL scheme equal to the base's
// and not followed by "//" re-enters the relative states, so Node answers
// http://a.example/b/c/g and not a host called "g". "https:g" against the
// same base is the control -- a different scheme, so absolute.
const base = new URL("http://a.example/b/c/d;p?q#f");
const cases: string[] = [
    "g",
    "./g",
    "g/",
    "/g",
    "//g.example/x",
    "?y",
    "g?y",
    "#s",
    "g#s",
    "g?y#s",
    ";x",
    "g;x",
    "",
    ".",
    "./",
    "..",
    "../",
    "../g",
    "../..",
    "../../g",
    "/./g",
    "/../g",
    "g.",
    ".g",
    "g..",
    "..g",
    "./../g",
    "./g/.",
    "g/./h",
    "g/../h",
    "http:g",
    "https:g",
    "HTTP:g",
    "http://x.example/y",
    "data:text/plain,hi",
    "?",
    "#",
    "  g  ",
    "a\tb"
];
for (const c of cases) {
    let out: string;
    try {
        out = new URL(c, base).href;
    } catch {
        out = "<throw>";
    }
    console.log(JSON.stringify(c) + " -> " + out);
}

// The base's userinfo, port and query all take part: a path-relative input
// keeps the authority and drops the query, a query-only input keeps the
// path, and an empty input keeps both and drops only the fragment.
const rich = new URL("https://u:p@h.example:8443/x/y?a=1#z");
for (const c of ["q", "/q", "//o.example/q", "?n", "#m", ""]) {
    let out: string;
    try {
        out = new URL(c, rich).href;
    } catch {
        out = "<throw>";
    }
    console.log("S " + JSON.stringify(c) + " -> " + out);
}

// The resolved value is an ordinary URL: every getter answers, and
// toString() is href.
const r = new URL("../z?k=1#t", base);
console.log(r.protocol, r.host, r.hostname, r.pathname, r.search);
console.log(r.toString() === r.href ? "toString is href" : "MISMATCH");
console.log(r.searchParams.get("k"));

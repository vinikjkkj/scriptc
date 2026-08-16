// new URL(input, base) -- the base forms, the non-special schemes, and the
// three ways the pair throws.
//
// A STRING base is the same call with the base parsed FIRST, which is also
// Node's order: an unparsable base throws "Invalid URL" before the input
// is looked at (rows J3/J4 -- the second passes a perfectly good absolute
// input and still throws).
//
// A base with an OPAQUE path ("data:text/plain,hi") is not a resolution
// base: only a fragment-only input resolves against it, everything else
// throws -- including the empty input, which is the row a "just return the
// base" shortcut would get wrong (row E3).
const BS: string = String.fromCharCode(92);

function show(label: string, input: string, base: string): void {
    let out: string;
    try {
        out = new URL(input, new URL(base)).href;
    } catch {
        out = "<throw>";
    }
    console.log(label + " " + JSON.stringify(input) + " @ " + JSON.stringify(base) + " -> " + out);
}

function showStringBase(label: string, input: string, base: string): void {
    let out: string;
    try {
        out = new URL(input, base).href;
    } catch {
        out = "<throw>";
    }
    console.log(label + " " + JSON.stringify(input) + " @s " + JSON.stringify(base) + " -> " + out);
}

// A base with no path at all still roots the result.
show("A1", "x", "http://h.example");
show("A2", "x", "http://h.example/");
show("A3", "/x", "http://h.example");
show("A4", "?q", "http://h.example");
show("A5", "#f", "http://h.example");
show("A6", "", "http://h.example/a?b#c");
// Default ports are stripped by the parser, non-default ones survive.
show("B1", "x", "https://h.example:443/a/b");
show("B2", "x", "http://h.example:8080/a/b");
show("B3", "x", "ws://h.example/a/b");
show("B4", "x", "wss://h.example/a/b");
// file: -- special, and "//" takes an authority.
show("C1", "x", "file:///a/b/c");
show("C2", "/x", "file:///a/b/c");
show("C3", "//h/x", "file:///a/b/c");
// git: -- NOT special, so no backslash folding, but "//" still authorities.
show("D1", "x", "git://h.example/a/b");
show("D2", "/x", "git://h.example/a/b");
show("D3", "//o/x", "git://h.example/a/b");
show("D4", "#f", "git://h.example/a/b");
// An opaque base takes a fragment and nothing else.
show("E1", "x", "data:text/plain,hi");
show("E2", "#f", "data:text/plain,hi");
show("E3", "", "data:text/plain,hi");
// Backslashes act as slashes iff the base's scheme is special.
show("F1", ".." + BS + "x", "http://h.example/a/b/c");
show("F2", BS + "x", "http://h.example/a/b/c");
show("F3", "x" + BS + "y", "http://h.example/a/b/c");
// Percent encoding is the parser's, and %2e counts as a dot segment.
show("G1", "a b", "http://h.example/p/");
show("G2", "a\"b", "http://h.example/p/");
show("G3", "a%20b", "http://h.example/p/");
show("G4", "%2e%2e/x", "http://h.example/a/b/c");
// A protocol-relative input replaces the authority; a foreign scheme wins.
show("H1", "//h.example", "http://o.example/a");
show("H2", "ftp:x", "ftp://h.example/a/b");
show("H3", "mailto:a@b", "http://h.example/a");
// The base's query and fragment are dropped in the right order.
show("I1", "?a=1&b=2#z", "http://h.example/p/q?old#oldf");
show("I2", "/?a", "http://h.example/p/q?old#oldf");
// The string-base form, including the base-throws-first pair.
showStringBase("J1", "x", "http://h.example/a/b");
showStringBase("J2", "/x", "https://u@h.example:9/a/b?c#d");
showStringBase("J3", "x", "not a url");
showStringBase("J4", "http://o.example/", "not a url");

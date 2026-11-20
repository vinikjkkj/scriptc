// URL inside new Function text runs on the static runtime's WHATWG parser: components read and write, searchParams stays linked to the query, invalid input throws ERR_INVALID_URL, and console.log prints Node's URL shape (also nested).
const run: any = new Function(`
  const u = new URL("https://u:p@a.com:8080/x/y?q=1&r=2#h");
  console.log(u);
  console.log(String(u), JSON.stringify(u), u.origin, Object.prototype.toString.call(u));
  u.searchParams.append("z", "a b"); console.log(u.search, u.href);
  u.searchParams.delete("q"); console.log(u.search);
  u.search = "?k=v"; console.log([...u.searchParams], u.searchParams.get("k"));
  u.pathname = "/new path"; u.hash = "frag"; u.port = "99"; u.hostname = "b.org"; u.protocol = "http"; u.username = "me"; u.password = "";
  console.log(u.href);
  u.href = "ftp://f.example/z"; console.log(u.host, u.protocol, u.searchParams.size);
  try { new URL("nope"); } catch (e) { console.log(e.name, e.code, e.message, e.input); }
  try { new URL("/rel", "bad base"); } catch (e) { console.log(e.name, e.code, e.input, e.base); }
  try { u.href = "::bad"; } catch (e) { console.log(e.name, e.code, e.message); }
  console.log(new URL("../a/./b?x#y", "http://h.com/c/d/e").href, URL.canParse("x"), URL.canParse("x:y"), URL.parse("q"), URL.parse("http://z").host);
  console.log({ u: new URL("http://x.org/") }, [new URLSearchParams("z=9")]);
  console.log(new URL("file:///tmp/a b.txt").pathname, new URL("http://EXAMPLE.com:80/%7Efoo").href);
`);
run();

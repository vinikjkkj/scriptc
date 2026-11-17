// Regexes first (engine cold), then Function/eval-style engine use, then regexes again (engine hot).
function show(label: string, v: unknown): void { console.log(label + ": " + JSON.stringify(v)); }
const src: string = process.argv.length > 0 ? "return a * b + (typeof x)" : "";

const re = /(\d+)/g;
show("before-1", "a1b22".match(re));
show("before-split", "x--y-z".split(/-+/));
const sticky = /z/y;
sticky.lastIndex = 1;
show("before-sticky", [sticky.test("az"), sticky.lastIndex]);

const f = new Function("a", "b", src);
show("engine-1", f(6, 7));
show("engine-2", new Function("return [1,2,3].map(function (v) { return v * 2 })")());
show("engine-regexp", new Function("return /(\\w+)@(\\w+)/.exec('me@host')")().slice(1));
show("engine-string-regex", new Function("s", "return s.replace(/o/g, '0')")("foo boo"));

show("after-1", "a1b22".match(re));
show("after-lastIndex", re.lastIndex);
show("after-split", "p--q-r".split(/-+/));
show("after-named", /(?<k>\w+)=(?<v>\w+)/.exec("key=val")!.groups);
const sticky2 = /q/y;
sticky2.lastIndex = 1;
show("after-sticky", [sticky2.test("pq"), sticky2.lastIndex]);
show("engine-3", new Function("a", "return a + 1")(41));

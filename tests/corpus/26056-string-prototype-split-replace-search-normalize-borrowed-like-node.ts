// String.prototype split/replace/replaceAll/match(g)/search/normalize/codePointAt/isWellFormed/toLocale*Case borrowed through an any prototype answer like Node, not by a deferred throw.
const p: any = String.prototype;
const out: string[] = [];
function t(name: string, f: () => any) { try { out.push(name + "=" + JSON.stringify(f())); } catch (e) { out.push(name + "!" + (e as Error).message.slice(0, 70)); } }
t("split", () => p.split.call("a,b;c d", ","));
t("splitre", () => p.split.call("a,b;c d", /[,; ]/));
t("splitlim", () => p.split.call("abc", "", 2));
t("splitnone", () => p.split.call("abc"));
t("split0", () => p.split.call("abc", ",", 0));
t("replace", () => p.replace.call("abcb", "b", "X"));
t("replacere", () => p.replace.call("abcb", /b/g, "[$&]"));
t("replacecap", () => p.replace.call("john smith", /(\w+) (\w+)/, "$2, $1"));
t("replaceAll", () => p.replaceAll.call("aXa", "a", "$&$&"));
t("replaceAllempty", () => p.replaceAll.call("ab", "", "-"));
t("replaceAllre", () => p.replaceAll.call("aXa", /a/g, "-"));
t("replaceAllnog", () => p.replaceAll.call("aXa", /a/, "-"));
t("matchg", () => p.match.call("abab", /a/g));
t("matchgnone", () => p.match.call("abab", /z/g));
t("search", () => p.search.call("abc", /c/));
t("normalize", () => p.normalize.call("Å", "NFC").length);
t("normbad", () => p.normalize.call("a", "XX"));
t("cpa", () => [p.codePointAt.call("a\u{1F600}", 1), p.codePointAt.call("abc", 9), p.codePointAt.call("abc")]);
t("lc", () => [p.toLocaleLowerCase.call("ABC"), p.toLocaleUpperCase.call("abcß")]);
t("iwf", () => [p.isWellFormed.call("ab"), p.toWellFormed.call("ab").length]);
t("nullthis", () => p.split.call(null, ","));
t("numthis", () => p.replace.call(12321, "2", "x"));
console.log(out.join("\n"));

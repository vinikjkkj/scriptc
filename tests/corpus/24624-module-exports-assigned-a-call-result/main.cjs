const mk = require("./dep.cjs");
const d = mk("app");
console.log(typeof mk, d("a", 1), d.namespace);
console.log(mk.formatters.o(5), mk.formatters.x("z"), mk.humanize(3), mk.human(4));
console.log(typeof mk.env.colorsLater, mk.env.colorsLater(), mk.env.tag, mk.env.colors.length, mk.colorsLater === undefined, mk.tag === undefined);

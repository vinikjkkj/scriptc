"use strict";
const utils = require("./utils.js");
const hdr = { a: 1 };
console.log(utils.isObject(hdr), utils.isObject(null), utils.isObject(3), utils.isObject(() => 1));
console.log(utils.hasOwn(hdr, "a"), utils.hasOwn(hdr, "b"));
console.log(typeof utils.isObject, typeof utils.hasOwn);
const pick = utils.isObject;
console.log(pick([]), pick(undefined));

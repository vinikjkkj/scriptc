"use strict";
const utils = require("./utils.js");
console.log(utils.isObject({}), utils.isObject("x"), utils.twice({}), utils.twice(7));
console.log(typeof utils.isObject, typeof utils.twice);

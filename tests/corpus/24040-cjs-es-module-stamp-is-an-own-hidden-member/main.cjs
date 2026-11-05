"use strict";
// tsc's default-import helper: a stamped module is used as is, anything else is wrapped as { default: module }.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const stamped = require("./stamped.cjs");
const plain = require("./plain.cjs");
const stamped_1 = __importDefault(require("./stamped.cjs"));
const plain_1 = __importDefault(require("./plain.cjs"));

// The stamp is an own member of the module's object that does not appear among its keys.
console.log(Object.keys(stamped).join(), stamped.__esModule, "__esModule" in stamped, Object.hasOwn(stamped, "__esModule"));
console.log(plain.__esModule, typeof plain);
for (const k in stamped) console.log("key", k);
// ...and it is the FIRST own name, ahead of every export, as the stamp is the module's first statement.
console.log(Object.getOwnPropertyNames(stamped).join(), Reflect.ownKeys(stamped).join());
console.log(Object.prototype.hasOwnProperty.call(stamped, "__esModule"), Object.prototype.hasOwnProperty.call(stamped, "twice"), Object.entries(stamped).length);
// A property defined hidden before any member is first too; one defined after a member is not (and has no list here).
const lead = {};
Object.defineProperty(lead, "h", { value: 1 });
lead.x = 2;
console.log(Object.getOwnPropertyNames(lead).join(), Object.keys(lead).join());
console.log(JSON.stringify(stamped));

// The helper's two answers.
console.log(typeof stamped_1.default, typeof stamped_1.twice, Object.keys(stamped_1).join());
console.log(typeof plain_1.default, plain_1.default(41), Object.keys(plain_1).join());

// The call form tsc emits for an imported function.
const r = (0, stamped_1.default)(Promise.resolve(5), (e, v) => console.log("cb", e, v));
r.then((v) => console.log("then", v));
console.log((0, stamped_1.twice)(21), (0, plain_1.default)(1));

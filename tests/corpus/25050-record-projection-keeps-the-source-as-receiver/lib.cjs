"use strict";
exports.mk = function () {
  return { n: 5, name: "x", exec() { return this.n + 1; }, getName() { return this.name + "!"; }, get g() { return this.name + "?" + this.n; } };
};
function P() { this.n = 7; this.name = "pp"; }
P.prototype.exec = function () { return this.n + 1; };
P.prototype.getName = function () { return this.name + "!"; };
Object.defineProperty(P.prototype, "g", { get() { return this.name + "?" + this.n; } });
exports.mkp = function () { return new P(); };
class K {
  constructor() { this.n = 9; this.name = "kk"; }
  exec() { return this.n + 1; }
  getName() { return this.name + "!"; }
  get g() { return this.name + "?" + this.n; }
}
exports.mkk = function () { return new K(); };
function I() {
  this.n = 3;
  this.name = "ii";
  this.exec = function () { return this.n + 1; };
  this.getName = function () { return this.name + "!"; };
  Object.defineProperty(this, "g", { get() { return this.name + "?" + this.n; } });
}
exports.mki = function () { return new I(); };
exports.peek = function (o) { return o.n; };
exports.bump = function (o) { o.n += 1; };

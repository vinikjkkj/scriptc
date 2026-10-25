export default class Cfg {
  static level = 1;
  static tag = "x";
  constructor(n) { this.n = n; }
  hi() { return "hi" + Cfg.level + ":" + Cfg.tag; }
}

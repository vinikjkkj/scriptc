// The mysql2 queryOptions pattern: a 46-member literal plus Object.assign of five more keys per command, 1,000 held then dropped, then 2,000 small objects held. Census OBJ cap row at exit: the 1,000 small objects that inherit a dropped table must read cap 57 with the fix; the unmodified build reads cap 92 (positive control, 97.8% unfilled).
// Afterwards 2,000 two-member objects are held live: the census must show how much table capacity they carry.
class Cfg {
  constructor() {
    this.opt0 = 0;
    this.opt1 = 1;
    this.opt2 = 2;
    this.opt3 = 3;
    this.opt4 = 4;
    this.opt5 = 5;
    this.opt6 = 6;
    this.opt7 = 7;
    this.opt8 = 8;
    this.opt9 = 9;
    this.opt10 = 10;
    this.opt11 = 11;
    this.opt12 = 12;
    this.opt13 = 13;
    this.opt14 = 14;
    this.opt15 = 15;
    this.opt16 = 16;
    this.opt17 = 17;
    this.opt18 = 18;
    this.opt19 = 19;
    this.opt20 = 20;
    this.opt21 = 21;
    this.opt22 = 22;
    this.opt23 = 23;
    this.opt24 = 24;
    this.opt25 = 25;
    this.opt26 = 26;
    this.opt27 = 27;
    this.opt28 = 28;
    this.opt29 = 29;
    this.opt30 = 30;
    this.opt31 = 31;
    this.opt32 = 32;
    this.opt33 = 33;
    this.opt34 = 34;
    this.opt35 = 35;
    this.opt36 = 36;
    this.opt37 = 37;
    this.opt38 = 38;
    this.opt39 = 39;
    this.opt40 = 40;
    this.opt41 = 41;
    this.opt42 = 42;
    this.opt43 = 43;
    this.opt44 = 44;
    this.opt45 = 45;
  }
  static queryOptions(cfg, overrides) {
    const options = { opt0: cfg.opt0, opt1: cfg.opt1, opt2: cfg.opt2, opt3: cfg.opt3, opt4: cfg.opt4, opt5: cfg.opt5, opt6: cfg.opt6, opt7: cfg.opt7, opt8: cfg.opt8, opt9: cfg.opt9, opt10: cfg.opt10, opt11: cfg.opt11, opt12: cfg.opt12, opt13: cfg.opt13, opt14: cfg.opt14, opt15: cfg.opt15, opt16: cfg.opt16, opt17: cfg.opt17, opt18: cfg.opt18, opt19: cfg.opt19, opt20: cfg.opt20, opt21: cfg.opt21, opt22: cfg.opt22, opt23: cfg.opt23, opt24: cfg.opt24, opt25: cfg.opt25, opt26: cfg.opt26, opt27: cfg.opt27, opt28: cfg.opt28, opt29: cfg.opt29, opt30: cfg.opt30, opt31: cfg.opt31, opt32: cfg.opt32, opt33: cfg.opt33, opt34: cfg.opt34, opt35: cfg.opt35, opt36: cfg.opt36, opt37: cfg.opt37, opt38: cfg.opt38, opt39: cfg.opt39, opt40: cfg.opt40, opt41: cfg.opt41, opt42: cfg.opt42, opt43: cfg.opt43, opt44: cfg.opt44, opt45: cfg.opt45 };
    return Object.assign(options, overrides);
  }
}
const cfg = new Cfg();
let acc = 0;
// 1,000 commands queued with their options held at once, then all settled: a bulk drop of big tables
function wave() {
  let held = [];
  for (let i = 0; i < 1000; i++) {
    const o = Cfg.queryOptions(cfg, { sql: "select " + i, values: [i], rowsAsArray: false, nestTables: false, timeout: 5 });
    acc += o.opt3 + o.timeout;
    held.push(o);
  }
  held = null;
}
wave();
const keep = [];
for (let i = 0; i < 2000; i++) keep.push({ a: i, b: "x" });
let n = 0; for (const k of keep) n += k.a;
setTimeout(() => { console.log(acc, n, keep.length); process.exit(0); }, 20);

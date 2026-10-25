// Element read on the RegExp match result (an array of strings or null), as mysql2's resultset header does.
class Hdr {
  constructor(info) { this.info = info; this.changedRows = 0; }
  parse() {
    const m = this.info.match(/\schanged:\s*(\d+)/i);
    if (m !== null) {
      this.changedRows = parseInt(m[1], 10);
    } else {
      this.changedRows = 0;
    }
    return this.changedRows;
  }
}
console.log(new Hdr('Rows matched: 1  Changed: 7  Warnings: 0').parse());
console.log(new Hdr('none').parse());

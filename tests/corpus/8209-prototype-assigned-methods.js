// `C.prototype.m = <function>`: methods added to a class after its body, as
// mysql2's Execute borrows Query's and ws's WebSocket takes its
// addEventListener. The borrowed body runs with `this` = the receiving class.
class Query {
  constructor() {
    this.rows = 0;
    this.sql = 'select 1';
    this.log = '';
  }

  row(packet) {
    this.rows += 1;
    this.log += 'row' + this.rows + ':' + packet + ' ';
    return this.rows;
  }

  describe() {
    return this.sql + ' / ' + this.rows;
  }

  then(label) {
    return 'then ' + label + ' on ' + this.sql;
  }
}

// the same-class alias (Query.prototype.catch = Query.prototype.then)
Query.prototype.catch = Query.prototype.then;

class Execute {
  constructor() {
    this.rows = 10;
    this.sql = 'execute 2';
    this.log = '';
  }
}

// borrowed from another class: unrelated layouts that share field names
Execute.prototype.row = Query.prototype.row;
Execute.prototype.describe = Query.prototype.describe;

// a free function installed as a method
function shout(word) {
  return word.toUpperCase() + ' from ' + this.sql;
}
Execute.prototype.shout = shout;

const q = new Query();
q.row('a');
q.row('b');
console.log(q.describe(), '|', q.log);
console.log(q.then('x'), '|', q.catch('y'));

const e = new Execute();
console.log(e.row('p'), e.row('q'));
console.log(e.describe(), '|', e.log);
console.log(e.shout('hey'));

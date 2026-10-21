class Command {
  constructor() {
    this.next = null;
  }

  finish(err) {
    const label = this.sql || this.query || 'none';
    if (this.onResult) {
      this.onResult(err, label);
      return 'callback';
    }
    return 'silent:' + label + ':' + (this.timeout === undefined ? 'unset' : this.timeout);
  }
}

class Query extends Command {
  constructor(sql, callback) {
    super();
    this.sql = sql;
    this.onResult = callback;
    this.timeout = 30;
  }
}

class Ping extends Command {
  constructor(callback) {
    super();
    this.onResult = callback;
  }
}

class Quit extends Command {
  constructor() {
    super();
    this.query = 'quit';
  }
}

const seen = [];
const q = new Query('select 1', (err, label) => seen.push('q:' + label + ':' + err));
const p = new Ping((err, label) => seen.push('p:' + label + ':' + err));
console.log(q.finish('E1'), p.finish('E2'));
console.log(new Quit().finish(null), new Command().finish(null));
console.log(seen.join('|'));

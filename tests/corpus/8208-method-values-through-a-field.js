// mysql2's command state machine: each state is a METHOD that answers the
// next method, the driver stores it in a field and calls it back through
// that field, so the call supplies `this`.
class Command {
  constructor() {
    this.next = null;
    this.trace = '';
  }

  execute(packet) {
    if (!this.next) this.next = this.start;
    this.next = this.next(packet);
    return this.next ? false : true;
  }
}

class Query extends Command {
  constructor(label) {
    super();
    this.label = label;
    this.rows = 0;
  }

  start(packet) {
    this.trace += this.label + ':start(' + packet + ') ';
    return this.header;
  }

  header(packet) {
    this.trace += 'header(' + packet + ') ';
    return packet === 'more' ? this.row : this.done;
  }

  row(packet) {
    this.rows += 1;
    this.trace += 'row' + this.rows + ' ';
    return this.rows < 3 ? this.row : this.done;
  }

  done(packet) {
    this.trace += 'done';
    return null;
  }
}

class Quiet extends Query {
  done(packet) {
    this.trace += 'quiet-done';
    return null;
  }
}

function drive(cmd, packets) {
  const out = [];
  for (const p of packets) {
    out.push(cmd.execute(p));
    if (out[out.length - 1]) break;
  }
  return out.join(',');
}

const q = new Query('q1');
console.log(drive(q, ['a', 'more', 'x', 'y', 'z']), '|', q.trace);
const s = new Quiet('q2');
console.log(drive(s, ['a', 'b', 'c']), '|', s.trace);

// a detached method called with no receiver throws, like Node's TypeError
const loose = q.header;
try {
  loose('p');
  console.log('no throw');
} catch (e) {
  console.log('threw', e instanceof TypeError);
}

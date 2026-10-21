class Packet {
  constructor(buffer) {
    this.parts = [];
    this.buffer = buffer;
    this.offset = 0;
  }

  add(chunk) {
    this.parts.push(chunk);
  }

  join() {
    return Buffer.concat(this.parts);
  }

  write(source) {
    const src = Buffer.from(source);
    src.copy(this.buffer, this.offset);
    this.offset += src.length;
  }
}

const p = new Packet(Buffer.alloc(8));
p.add(Buffer.from('ab'));
p.add(Buffer.from('cd'));
console.log(p.join().toString());
p.write(Buffer.from('xyz'));
p.write(Buffer.from('12'));
console.log(p.buffer.toString('hex'));

const bad = new Packet(Buffer.alloc(1));
bad.add('not a buffer');
try {
  bad.join();
} catch (e) {
  console.log(e.name, e.code);
}
const nobuf = new Packet(5);
try {
  nobuf.write(Buffer.from('q'));
} catch (e) {
  console.log(e.name, e.code);
}

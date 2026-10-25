// Three class arms in one union flowing into one record slot, read inside a loop.
type MessageName = 'parseComplete' | 'notice' | 'error' | 'closeComplete';
interface BackendMessage {
  length: number;
  name: string;
}
class Ok {
  readonly length: number;
  readonly name: MessageName;
  constructor(length: number) {
    this.length = length;
    this.name = 'parseComplete';
  }
}
class Warn {
  readonly length: number;
  readonly name = 'notice';
  constructor(length: number) {
    this.length = length;
  }
}
class Fail {
  readonly length: number;
  readonly name: MessageName;
  readonly detail: string;
  constructor(length: number, detail: string) {
    this.length = length;
    this.name = 'error';
    this.detail = detail;
  }
}
function make(k: number): Ok | Warn | Fail {
  if (k === 0) return new Ok(1);
  if (k === 1) return new Warn(2);
  return new Fail(3, 'boom');
}
const seen: BackendMessage[] = [];
for (let k = 0; k < 3; k++) {
  const m: BackendMessage = make(k);
  seen.push(m);
}
for (const m of seen) console.log(m.length, m.name);

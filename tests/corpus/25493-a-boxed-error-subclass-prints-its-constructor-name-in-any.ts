// An Error subclass boxed into an `any` parameter prints exactly like the typed value: the constructor-name prefix when the name was never
// assigned (`[MyErr [Error]: boom]`), the assigned name when it was, and the declared fields in the braces.
(Error as any).stackTraceLimit = 0;
class MyErr extends Error {
  code: string;
  constructor() { super('boom'); this.code = 'X'; }
}
class Named extends Error {
  code: string;
  constructor() { super('named'); this.name = 'Named'; this.code = 'N'; }
}
class WaLikeError extends Error {
  retryable: boolean;
  constructor() { super('nack'); this.name = 'WaLikeError'; this.retryable = true; }
}
function use(x: any): void { console.log(x); }
use(new MyErr());
use(new Named());
use(new WaLikeError());
use([new MyErr()]);
use({ e: new Named() });

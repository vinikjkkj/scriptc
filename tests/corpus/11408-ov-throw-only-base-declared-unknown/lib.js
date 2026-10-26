// The base's body only throws: its JS return is inferred `never`, while the
// declaration file says `unknown`. The subclass override returns values.
export class Commander {
  send(command, stream) { throw new Error('"send" is not implemented'); }
}
export default class Redis extends Commander {
  send(command, stream) { return 'redis:' + command + ':' + (stream === undefined ? 'none' : stream); }
}

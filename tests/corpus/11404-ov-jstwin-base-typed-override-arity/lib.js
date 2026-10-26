export class Base {
  send(command, stream) {
    return "base:" + command + ":" + stream;
  }
}
export default class Redis extends Base {
  constructor(port) {
    super();
    this.port = port;
  }
  send(command, stream, node) {
    return "redis:" + command + ":" + (stream === undefined ? "none" : stream) + ":" + node + ":" + this.port;
  }
}
Redis.Cluster = 1;
Redis.Command = "cmd";

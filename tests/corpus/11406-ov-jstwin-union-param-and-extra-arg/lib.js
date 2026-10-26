export class Sock {
  constructor() {
    this.fd = 3;
  }
}
export class Base {
  send(command, stream) {
    return "base:" + command + ":" + (stream === undefined ? "none" : "stream");
  }
}
export default class Sub extends Base {
  send(command, stream, node) {
    const kind = stream === undefined ? "none" : stream.isPipeline ? "pipe" : "sock" + stream.fd;
    return "sub:" + command + ":" + kind + ":" + (node === undefined ? "-" : node);
  }
}
Sub.tag = "t";

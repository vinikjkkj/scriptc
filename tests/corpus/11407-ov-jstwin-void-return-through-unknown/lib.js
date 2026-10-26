import Cmd from "./cmd.js";
export class Sock {
  constructor() {
    this.fd = 3;
  }
}
export class Commander {
  sendCommand(command, stream) {
    return command.name;
  }
}
export default class Redis extends Commander {
  sendCommand(command, stream) {
    command.setReplyContext("ctx");
    if (stream !== undefined) {
      this.lastStream = stream;
    }
  }
}
Redis.Cluster = 1;

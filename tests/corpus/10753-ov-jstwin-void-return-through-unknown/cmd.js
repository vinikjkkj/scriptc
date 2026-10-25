export default class Cmd {
  constructor(name) {
    this.name = name;
    this.promise = Promise.resolve(name);
  }
  setReplyContext(x) {
    this.ctx = x;
  }
}

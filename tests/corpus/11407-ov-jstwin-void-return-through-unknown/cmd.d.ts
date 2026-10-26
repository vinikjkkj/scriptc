export default class Cmd {
  constructor(name: string);
  name: string;
  promise: Promise<unknown>;
  setReplyContext(x: unknown): void;
}

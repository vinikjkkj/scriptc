interface Cmd {
  call(command: string, callback?: (reply: string) => void): number;
  call(command: string, args: (string | number)[], callback?: (reply: string) => void): number;
  call(...args: [command: string, ...rest: (string | number)[], callback: (reply: string) => void]): number;
  call(...args: [command: string, ...rest: (string | number)[]]): number;
}
const cmd: Cmd = {
  call(...args: unknown[]): number {
    const last = args[args.length - 1];
    if (typeof last === "function") (last as (reply: string) => void)("ok:" + String(args[0]));
    return args.length;
  },
};
function run(c: Cmd): void {
  console.log(c.call("PING"));
  console.log(c.call("SET", ["k", 1]));
  console.log(c.call("GET", "k", "x", (reply: string) => console.log("reply", reply)));
  console.log(c.call("DEL", "a", 2));
}
run(cmd);

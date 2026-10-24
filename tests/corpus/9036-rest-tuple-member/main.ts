interface Sink {
  send(...args: [kind: string, ...parts: number[], done: (n: number) => void]): void;
}
const sink: Sink = {
  send(...args: [kind: string, ...parts: number[], done: (n: number) => void]): void {
    let total = 0;
    for (let i = 1; i < args.length - 1; i++) total += args[i] as number;
    console.log(args[0], total);
    const done = args[args.length - 1] as (n: number) => void;
    done(total);
  },
};
function run(s: Sink): void {
  s.send("x", 1, 2, 3, (n: number) => console.log("done", n));
  s.send("y", (n: number) => console.log("empty", n));
}
run(sink);

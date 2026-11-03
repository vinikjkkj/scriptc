// ioredis built/Script.js shape: an evaluated class (class CustomScriptCommand extends Command) stored
// into an untyped (any) field of a real class and constructed through it.
// ioredis Script-shaped: an evaluated class stored on a real class's this.X
class Command { name: string; args: any[]; constructor(name: string, args: any[]) { this.name = name; this.args = args; } toWritable(s: string) { return this.name + ":" + s; } }
class Script {
  Command: any; private lua: string; private sha: string;
  constructor(lua: string, n: number) {
    this.lua = lua;
    this.sha = "sha" + lua.length;
    const sha = this.sha;
    const seen = new Set<string>();
    this.Command = class CustomScriptCommand extends Command {
      toWritable(socket: string) {
        if (!seen.has(socket)) { seen.add(socket); this.name = "eval"; this.args[0] = lua; }
        else { this.name = "evalsha"; this.args[0] = sha; }
        return super.toWritable(socket);
      }
    };
  }
  run(sock: string) { const c = new this.Command("x", [0]); return c.toWritable(sock) + c.args[0]; }
}
const s = new Script("return 1", 0);
console.log(s.run("a"), s.run("b"));
const T = s.Command;
console.log(typeof T, T.name);

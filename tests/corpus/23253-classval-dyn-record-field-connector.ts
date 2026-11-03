// ioredis RedisOptions.Connector: a class value in a record field that is deep-copied into dyn.
// Connector-shaped: a class value in a record field that is deep-copied into dyn
class AbstractConnector { o: number; constructor(o: number) { this.o = o; } describe() { return "abs" + this.o; } }
class StandaloneConnector extends AbstractConnector { describe() { return "sa" + this.o; } }
interface ConnectorConstructor { new (o: number): AbstractConnector }
interface RedisOptions { host: string; Connector?: ConnectorConstructor }
function take(x: unknown): string { const o = x as any; const C = o.Connector; return o.host + ":" + (C ? new C(5).describe() : "none") + ":" + typeof C; }
const opts: RedisOptions = { host: "h", Connector: StandaloneConnector };
console.log(take(opts));
console.log(take({ host: "g" }));

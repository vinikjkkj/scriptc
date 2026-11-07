// A pool library writes members its Client class never declares through an UNTYPED parameter (pg-pool's `client._poolUseCount = ...`
// in _release). Node stores them as own properties of the instance; the compiled instance was a boxed class instance with no table:
// "a property write on a dynamic Client is not supported yet".
import { Pool } from "pgpool";
const pool = new Pool({ host: "h" });
pool.acquire((err: unknown, client: { connected: boolean; release(): number }) => {
  console.log(err, client.connected);
  console.log(client.release(), client.release(), pool.idle.length);
});

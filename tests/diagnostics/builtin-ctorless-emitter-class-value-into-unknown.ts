import { EventEmitter } from "node:events";

// An inherited emitter constructor takes options (captureRejections) that a construct through an untyped
// slot would drop: such a class value does not cross into `unknown`.
class Bus extends EventEmitter {}
function take(c: unknown): void {
  void c;
}
take(Bus);

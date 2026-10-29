import { CountOp, NameOp } from './count.ts';
import { MongoDBResponse } from './responses.ts';
const bytes = new Uint8Array([3, 4, 5, 6, 7]);
const r = new MongoDBResponse(bytes, 0);
console.log(new CountOp().handleOk(r), new NameOp().handleOk(r));
console.log(new NameOp().handleOk(new MongoDBResponse(bytes, 2)));

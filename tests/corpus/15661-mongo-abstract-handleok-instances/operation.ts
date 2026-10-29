// Real mongodb shape: AbstractOperation<TResult>.handleOk(response: InstanceType<typeof this.X>) calls
// response.toObject on a subclass-typed value; two concrete instantiations (number and string results).
import { MongoDBResponse } from './responses.ts';

export abstract class AbstractOperation<TResult = any> {
  abstract SERVER_COMMAND_RESPONSE_TYPE: typeof MongoDBResponse;
  bsonOptions = { promoteValues: true };
  abstract finish(doc: Record<string, unknown>): TResult;
  handleOk(response: InstanceType<typeof this.SERVER_COMMAND_RESPONSE_TYPE>): TResult {
    return this.finish(response.toObject(this.bsonOptions));
  }
}

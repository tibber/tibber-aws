/**
 * Consumer probe — types half. Type-checked with `tsc --noEmit` (strict) inside
 * the scratch project, against the .d.ts files emitted into the tarball.
 *
 * Complements `attw`, which the harness also runs: attw proves the
 * declarations *resolve* under each module-resolution mode, this proves they
 * are *usable* — that documented call shapes still compile and that the public
 * generics still infer. A breaking signature change is green under attw and
 * red here.
 *
 * Nothing in this file executes (noEmit), so the AWS calls below never happen.
 */
import {
  configure,
  getLambdaFunc,
  getSecret,
  getSecretCollection,
  Queue,
  QueueSubjectListener,
  S3Bucket,
  Topic,
} from 'tibber-aws';

// configure() takes a named-args object.
configure({region: 'eu-west-1'});

// getSecret returns `string | undefined` — consumers branch on that, so the
// optionality is part of the contract.
const secret: string | undefined = getSecret('my-secret', 'password');
void secret;

// getSecretCollection is generic over the collection shape and defaults to
// Record<string, string>.
type DbCreds = {host: string; password: string};
const creds: DbCreds | undefined = getSecretCollection<DbCreds>('db-secret');
void creds;
const defaulted: Record<string, string> | undefined = getSecretCollection('other-secret');
void defaulted;

// The documented queue-listener flow from the readme.
const listen = async (): Promise<void> => {
  const queue: Queue = await Queue.createQueue('test-queue');
  const listener = new QueueSubjectListener(queue);
  listener.onSubject('test', async (message: unknown, subject: string) => {
    void message;
    void subject;
  });
};
void listen;

// getOrCreateBucket swallows failures and resolves to `undefined`, so the
// optionality is part of the contract consumers must branch on — pin it rather
// than assume a bucket comes back.
const buckets = async (): Promise<void> => {
  const bucket: S3Bucket | undefined = await S3Bucket.getOrCreateBucket('some-bucket');
  if (bucket) {
    const name: string = bucket.name;
    const created: Date = bucket.creationDate;
    void name;
    void created;
  }
};
void buckets;

// Topic and getLambdaFunc are exported for consumers too — pin that they are
// at least referenceable as values with the expected shape.
void Topic;
void getLambdaFunc;

# tibber-aws
Thie repo is a typescript wrapper around the AWS SDK for Javascript.

## Running tests locally

Tests run against [Floci](https://github.com/floci-io/floci), a free local AWS emulator.

### Steps

1. Start Floci and seed test resources:

```bash
docker compose -f docker-compose-test.yml up -d
```

2. Wait for the `create-resources` container to finish (check with `docker compose -f docker-compose-test.yml logs create-resources`).

3. Run the tests:

```bash
yarn
yarn test
```

4. When done, tear down the containers:

```bash
docker compose -f docker-compose-test.yml down
```

## Version 6.x.x changes
- Migrated to aws sdk 3.x
- Removed ECS Api

## Features

### Queue Message Compression Support
The library now supports automatic decompression of SQS messages compressed with Brotli or GZip. Messages with a `contentType` message attribute set to `brotli` or `gzip` will be automatically decompressed.

```typescript
import {QueueSubjectListener, Queue} from 'tibber-aws';

const queue = await Queue.createQueue('test-queue');
const listener = new QueueSubjectListener(queue);

listener.onSubject('test', async (message, subject) => {
  // Message is automatically decompressed if compressed
  console.log(message);
});

listener.listen();
```

## Usage

```
import {Topic, Queue} from 'tibber-aws';

const topic = await Topic.createTopic('test-topic', 'test subject');
const topic2 = await Topic.createTopic('test-topic2');

//create (or get) queue
const queue = await Queue.createQueue('test-queue');

//subscribe queue to topics
await queue.subscribeTopic(topic);
await queue.subscribeTopic(topic2);

//push json event to queue
await topic.push({ test: "test" });
await topic2.push({ test: "test2" }, 'test subject2');

//consume queue
const listener = new QueueSubjectListener(queue);
listener.handlers = [handlerFunction];
listener.listen();

```
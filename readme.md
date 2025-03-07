# tibber-aws
Thie repo is a typescript wrapper around the AWS SDK for Javascript.

## Version 6.x.x changes
- Migrated to aws sdk 3.x
- Removed ECS Api

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

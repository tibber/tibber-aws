import {
  InvalidParameterException,
  NotFoundException,
} from '@aws-sdk/client-sns';
import {QueueDoesNotExist} from '@aws-sdk/client-sqs';
import {randomBytes} from 'crypto';
import {Queue, QueueSubjectListener, Topic} from '../src';

const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const oversized = {
  items: Array.from({length: 20000}, (_, id) => ({id, name: `item-${id}`})),
};
const incompressible = {data: randomBytes(3e5).toString('base64')};
const contentType = (StringValue: string) => ({
  contentType: {DataType: 'String', StringValue},
});

let listener: QueueSubjectListener | undefined;
afterEach(() => listener?.stop());

it.each([
  ['a message that fits', {userId: 42}, undefined, 1],
  ['an oversized message gzipped', oversized, contentType('gzip'), 2],
])(
  'delivers %s from an attached topic to an attached queue',
  async (_, payload, MessageAttributes, publishes) => {
    const queueName = uniqueName('attached-q');
    const topicName = uniqueName('attached-t');
    const provisioned = await Queue.createQueue(queueName);
    await provisioned.subscribeTopic(await Topic.createTopic(topicName));

    const queue = await Queue.attach(queueName);
    expect(queue.queueArn).toBe(provisioned.queueArn);
    const topic = await Topic.attach(topicName, 'user.created');
    await topic.verify();
    const publish = jest.spyOn(topic.sns, 'publish');

    const consumer = new QueueSubjectListener(queue);
    listener = consumer;
    const received = new Promise(resolve =>
      consumer.onSubject('user.created', async (message, subject) =>
        resolve({message, subject}),
      ),
    );
    consumer.listen();
    await topic.push(payload);
    await expect(received).resolves.toEqual({
      message: payload,
      subject: 'user.created',
    });
    expect(publish).toHaveBeenCalledTimes(publishes);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({MessageAttributes}),
    );
  },
  30000,
);

it.each([
  ['is incompressible', incompressible, undefined, 2],
  ['already has a contentType', oversized, contentType('json'), 1],
])(
  'rethrows the size error when an oversized message %s',
  async (_, payload, attributes, publishes) => {
    const topic = await Topic.createTopic(uniqueName('oversized-t'));
    const publish = jest.spyOn(topic.sns, 'publish');
    await expect(
      topic.push(payload, undefined, attributes),
    ).rejects.toBeInstanceOf(InvalidParameterException);
    expect(publish).toHaveBeenCalledTimes(publishes);
  },
);

it.each([
  [
    'Queue.attach',
    QueueDoesNotExist,
    () => Queue.attach(uniqueName('missing')),
  ],
  [
    'Topic.verify',
    NotFoundException,
    async () => (await Topic.attach(uniqueName('missing'))).verify(),
  ],
])('%s throws for a missing resource', async (_, error, attach) => {
  await expect(attach()).rejects.toBeInstanceOf(error);
});

const subjectAttribute = (StringValue?: string) =>
  StringValue ? {subject: {DataType: 'String', StringValue}} : undefined;

it.each([
  ['comes from the topic subject', 'topic', undefined, undefined, 'topic'],
  ['prefers the push subject', 'topic', 'push', undefined, 'push'],
  ['keeps a caller-set value', 'topic', 'push', 'caller', 'caller'],
  ['is omitted without a subject', undefined, undefined, undefined, undefined],
])(
  'subject message attribute %s',
  async (_, topicSubject, pushSubject, callerSubject, expected) => {
    const topic = await Topic.createTopic(uniqueName('subject'), topicSubject);
    const publish = jest.spyOn(topic.sns, 'publish');
    await topic.push({}, pushSubject, subjectAttribute(callerSubject));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({MessageAttributes: subjectAttribute(expected)}),
    );
  },
);

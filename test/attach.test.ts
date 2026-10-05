import {NotFoundException} from '@aws-sdk/client-sns';
import {QueueDoesNotExist} from '@aws-sdk/client-sqs';
import {Queue, QueueSubjectListener, Topic} from '../src';

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;

const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let listener: QueueSubjectListener | undefined;
afterAll(() => listener?.stop());

it('delivers from an attached topic to an attached queue', async () => {
  const queueName = uniqueName('attached-q');
  const topicName = uniqueName('attached-t');
  const provisioned = await Queue.createQueue(queueName, awsEndpointUrl);
  await provisioned.subscribeTopic(await Topic.createTopic(topicName));

  const queue = await Queue.attach(queueName, awsEndpointUrl);
  expect(queue.queueArn).toBe(provisioned.queueArn);
  const topic = await Topic.attach(topicName, 'user.created');
  await topic.verify();

  const consumer = new QueueSubjectListener(queue);
  listener = consumer;
  const received = new Promise(resolve =>
    consumer.onSubject('user.created', async (message, subject) =>
      resolve({message, subject})
    )
  );
  consumer.listen();
  await topic.push({userId: 42});
  await expect(received).resolves.toEqual({
    message: {userId: 42},
    subject: 'user.created',
  });
}, 30000);

it.each([
  [
    'Queue.attach',
    QueueDoesNotExist,
    () => Queue.attach(uniqueName('missing'), awsEndpointUrl),
  ],
  [
    'Topic.verify',
    NotFoundException,
    async () => (await Topic.attach(uniqueName('missing'))).verify(),
  ],
])('%s throws for a missing resource', async (_, error, attach) => {
  await expect(attach()).rejects.toBeInstanceOf(error);
});

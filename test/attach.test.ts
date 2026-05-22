import {QueueDoesNotExist} from '@aws-sdk/client-sqs';
import {
  AttachedQueueListenerBuilder,
  Queue,
  Topic,
  configure,
} from '../src';

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;

const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 15000,
  intervalMs = 50
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor: predicate not satisfied within timeout');
};

beforeAll(() => {
  configure({region: 'eu-west-1'});
});

describe('Queue.attach', () => {
  it('resolves URL and ARN for an existing queue without calling create', async () => {
    const name = uniqueName('attach-q');
    const created = await Queue.createQueue(name, awsEndpointUrl);

    const sqsCreateSpy = jest.spyOn(created.sqs, 'createQueue');

    const attached = await Queue.attach(name, awsEndpointUrl);

    expect(attached.queueUrl).toBe(created.queueUrl);
    expect(attached.queueArn).toBe(created.queueArn);
    expect(sqsCreateSpy).not.toHaveBeenCalled();
  });

  it('throws QueueDoesNotExist for a queue that has not been provisioned', async () => {
    const name = uniqueName('attach-missing');
    await expect(Queue.attach(name, awsEndpointUrl)).rejects.toBeInstanceOf(
      QueueDoesNotExist
    );
  });
});

describe('Topic.fromArn / Topic.fromName', () => {
  it('Topic.fromArn populates fields from the ARN', () => {
    const topic = Topic.fromArn(
      'arn:aws:sns:eu-west-1:000000000000:never-created',
      'subj',
      awsEndpointUrl
    );

    expect(topic.topicArn).toBe(
      'arn:aws:sns:eu-west-1:000000000000:never-created'
    );
    expect(topic.name).toBe('never-created');
    expect(topic.subject).toBe('subj');
  });

  it.each([
    '',
    'not-an-arn',
    'arn:aws:sns:eu-west-1:000000000000:',
    'arn:aws:sns:eu-west-1:000000000000',
  ])('Topic.fromArn throws on malformed ARN %p', invalid => {
    expect(() => Topic.fromArn(invalid)).toThrow(/Invalid SNS topic ARN/);
  });

  it('Topic.fromName derives the partition from the region', () => {
    expect(
      Topic.fromName('t', '123', 'eu-west-1').topicArn.startsWith('arn:aws:sns:')
    ).toBe(true);
    expect(
      Topic.fromName('t', '123', 'cn-north-1').topicArn.startsWith(
        'arn:aws-cn:sns:'
      )
    ).toBe(true);
    expect(
      Topic.fromName('t', '123', 'us-gov-east-1').topicArn.startsWith(
        'arn:aws-us-gov:sns:'
      )
    ).toBe(true);
  });

  it('Topic.fromArn publishes against the supplied ARN', async () => {
    const topicName = uniqueName('from-arn-push');
    const real = await Topic.createTopic(topicName, undefined, awsEndpointUrl);

    const topic = Topic.fromArn(real.topicArn, 'subj', awsEndpointUrl);
    const result = await topic.push({hello: 'world'});

    expect(result.MessageId).toBeTruthy();
  });
});

describe('AttachedQueueListenerBuilder end-to-end', () => {
  it('consumes messages published via Topic.fromArn when topology is pre-provisioned', async () => {
    const queueName = uniqueName('attached-q');
    const topicName = uniqueName('attached-t');

    const provisionedQueue = await Queue.createQueue(queueName, awsEndpointUrl);
    const provisionedTopic = await Topic.createTopic(
      topicName,
      undefined,
      awsEndpointUrl
    );
    await provisionedQueue.subscribeTopic(provisionedTopic);

    const queue = await Queue.attach(queueName, awsEndpointUrl);

    const sqsCreateSpy = jest.spyOn(queue.sqs, 'createQueue');
    const snsSubscribeSpy = jest.spyOn(queue.sns, 'subscribe');
    const sqsSetAttrsSpy = jest.spyOn(queue.sqs, 'setQueueAttributes');

    const listener = new AttachedQueueListenerBuilder(queue).build();

    const received: Array<{message: unknown; subject: string}> = [];
    listener.onSubject('user.created', async (message, subject) => {
      received.push({message, subject});
    });
    listener.listen();

    const publisher = Topic.fromArn(
      provisionedTopic.topicArn,
      'user.created',
      awsEndpointUrl
    );
    await publisher.push({userId: 42});

    try {
      await waitFor(() => received.length > 0);
      expect(received[0]).toEqual({
        message: {userId: 42},
        subject: 'user.created',
      });
      expect(sqsCreateSpy).not.toHaveBeenCalled();
      expect(snsSubscribeSpy).not.toHaveBeenCalled();
      expect(sqsSetAttrsSpy).not.toHaveBeenCalled();
    } finally {
      listener.stop();
    }
  }, 30000);
});

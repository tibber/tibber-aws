import {SNS} from '@aws-sdk/client-sns';
import {Queue, Topic, configure} from '../src';

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;

const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

beforeAll(() => {
  configure({region: 'eu-west-1'});
});

describe('Queue.getOrCreateQueue (integration with Floci/LocalStack)', () => {
  it('creates the queue on first call and reuses it on the second', async () => {
    const name = uniqueName('goc-queue');

    const first = await Queue.getOrCreateQueue(name, awsEndpointUrl);
    expect(first.queueUrl).toBeTruthy();
    expect(first.queueArn).toMatch(/:sqs:.+:.+:/);

    const second = await Queue.getOrCreateQueue(name, awsEndpointUrl);
    expect(second.queueUrl).toBe(first.queueUrl);
    expect(second.queueArn).toBe(first.queueArn);
  });
});

describe('Topic.getOrCreateTopic (integration with Floci/LocalStack)', () => {
  it('falls back to createTopic when the topic does not exist yet', async () => {
    const queue = await Queue.getOrCreateQueue(
      uniqueName('goc-topic-q'),
      awsEndpointUrl
    );
    const topicName = uniqueName('goc-topic');

    const topic = await Topic.getOrCreateTopic(
      topicName,
      undefined,
      queue.queueArn,
      awsEndpointUrl
    );

    expect(topic.topicArn).toContain(topicName);

    // Verify the topic actually exists in SNS now — independent client.
    const sns = new SNS({endpoint: awsEndpointUrl});
    const attrs = await sns.getTopicAttributes({TopicArn: topic.topicArn});
    expect(attrs.Attributes?.TopicArn).toBe(topic.topicArn);
  });

  it('returns the existing topic without recreating when it already exists', async () => {
    const queue = await Queue.getOrCreateQueue(
      uniqueName('goc-topic-q'),
      awsEndpointUrl
    );
    const topicName = uniqueName('goc-topic');

    const first = await Topic.getOrCreateTopic(
      topicName,
      undefined,
      queue.queueArn,
      awsEndpointUrl
    );

    const second = await Topic.getOrCreateTopic(
      topicName,
      undefined,
      queue.queueArn,
      awsEndpointUrl
    );

    expect(second.topicArn).toBe(first.topicArn);
  });
});

describe('Queue.subscribeTopic (integration with Floci/LocalStack)', () => {
  it('skips setQueueAttributes and sns.subscribe when subscription already exists', async () => {
    const queueName = uniqueName('sub-q');
    const topicName = uniqueName('sub-t');

    // First instance — sets up the subscription.
    const setup = await Queue.getOrCreateQueue(queueName, awsEndpointUrl);
    const topic = await Topic.getOrCreateTopic(
      topicName,
      undefined,
      setup.queueArn,
      awsEndpointUrl
    );
    await setup.subscribeTopic(topic);

    // Fresh Queue instance for the same queue — _arnMap is empty so the
    // short-circuit must come from isAlreadySubscribed, not the in-memory dedup.
    const probe = await Queue.getOrCreateQueue(queueName, awsEndpointUrl);

    const listSubsSpy = jest.spyOn(probe.sns, 'listSubscriptionsByTopic');
    const setAttrsSpy = jest.spyOn(probe.sqs, 'setQueueAttributes');
    const subscribeSpy = jest.spyOn(probe.sns, 'subscribe');

    await probe.subscribeTopic(topic);

    // Positive: short-circuit reached via isAlreadySubscribed, not via the
    // in-memory _arnMap dedup (which is empty on a fresh Queue instance).
    expect(listSubsSpy).toHaveBeenCalled();
    expect(setAttrsSpy).not.toHaveBeenCalled();
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it('runs the full subscribe flow when no subscription exists yet', async () => {
    const queue = await Queue.getOrCreateQueue(
      uniqueName('sub-q'),
      awsEndpointUrl
    );
    const topic = await Topic.getOrCreateTopic(
      uniqueName('sub-t'),
      undefined,
      queue.queueArn,
      awsEndpointUrl
    );

    const subscribeSpy = jest.spyOn(queue.sns, 'subscribe');

    await queue.subscribeTopic(topic);

    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Topic.fromArn (publisher constructor)', () => {
  it('constructs a Topic instance from an ARN without any AWS API call', async () => {
    const topicName = uniqueName('from-arn-t');
    const real = await Topic.createTopic(topicName, undefined, awsEndpointUrl);

    const sns = new SNS({endpoint: awsEndpointUrl});
    const spy = jest.spyOn(sns, 'createTopic');
    // fromArn must not touch SNS — verify by inspecting an SNS client we
    // didn't pass in. The spy is only here as an assertion of intent: the
    // real check is that Topic.fromArn is synchronous and returns
    // immediately.
    const topic = Topic.fromArn(real.topicArn, 'meter-reading', awsEndpointUrl);

    expect(topic.topicArn).toBe(real.topicArn);
    expect(topic.name).toBe(topicName);
    expect(topic.subject).toBe('meter-reading');
    expect(spy).not.toHaveBeenCalled();
  });

  it('push() publishes against the supplied ARN', async () => {
    const topicName = uniqueName('from-arn-push');
    const real = await Topic.createTopic(topicName, undefined, awsEndpointUrl);

    const topic = Topic.fromArn(real.topicArn, 'meter-reading', awsEndpointUrl);
    const result = await topic.push({hello: 'world'});

    expect(result.MessageId).toBeTruthy();
  });

  it('push() against a non-existent ARN surfaces NotFoundException', async () => {
    // Same account+region prefix as real topics but with an ARN that does
    // not exist. The SDK should reject at push time.
    const bogusArn = 'arn:aws:sns:eu-west-1:000000000000:does-not-exist';
    const topic = Topic.fromArn(bogusArn, undefined, awsEndpointUrl);

    await expect(topic.push({hello: 'world'})).rejects.toThrow(
      /NotFound|Topic does not exist/i
    );
  });
});

describe('Topic.fromName (publisher convenience)', () => {
  it('assembles the ARN from accountId + region + name, no AWS call', async () => {
    const topicName = uniqueName('from-name-t');
    const real = await Topic.createTopic(topicName, undefined, awsEndpointUrl);
    // Floci returns 000000000000 as the account; eu-west-1 is the test region.
    const topic = Topic.fromName(
      topicName,
      '000000000000',
      'eu-west-1',
      'subj',
      awsEndpointUrl
    );

    expect(topic.topicArn).toBe(real.topicArn);
    expect(topic.name).toBe(topicName);
    expect(topic.subject).toBe('subj');
  });

  it('derives partition from region', () => {
    const std = Topic.fromName('t', '123', 'eu-west-1');
    expect(std.topicArn.startsWith('arn:aws:sns:')).toBe(true);

    const cn = Topic.fromName('t', '123', 'cn-north-1');
    expect(cn.topicArn.startsWith('arn:aws-cn:sns:')).toBe(true);

    const gov = Topic.fromName('t', '123', 'us-gov-east-1');
    expect(gov.topicArn.startsWith('arn:aws-us-gov:sns:')).toBe(true);
  });

  it('push() publishes against the assembled ARN', async () => {
    const topicName = uniqueName('from-name-push');
    await Topic.createTopic(topicName, undefined, awsEndpointUrl);

    const topic = Topic.fromName(
      topicName,
      '000000000000',
      'eu-west-1',
      undefined,
      awsEndpointUrl
    );
    const result = await topic.push({hello: 'world'});
    expect(result.MessageId).toBeTruthy();
  });
});

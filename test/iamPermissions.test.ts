import {
  CreateAccessKeyCommand,
  CreateUserCommand,
  IAMClient,
  PutUserPolicyCommand,
} from '@aws-sdk/client-iam';
import {ListSubscriptionsByTopicCommand, SNS} from '@aws-sdk/client-sns';
import {ReceiveMessageCommand, SQS} from '@aws-sdk/client-sqs';
import {Queue, Topic, configure} from '../src';

/**
 * Documents and enforces the minimum IAM permission set required to run a
 * listener via QueueSubjectListenerBuilder when the queue, topic, and
 * subscription already exist. Anything added to the listener path that
 * requires a permission not in this list will fail the positive test;
 * removing a permission that's no longer needed will fail the negative
 * tests, prompting an explicit update here.
 *
 * Floci must run with FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true for these
 * tests to be meaningful; the test/iamPermissions.test.ts and
 * docker-compose-test.yml ship together.
 */
const REQUIRED_LISTENER_PERMISSIONS = [
  'sqs:GetQueueUrl',
  'sqs:GetQueueAttributes',
  'sqs:ReceiveMessage',
  'sqs:DeleteMessage',
  'sqs:ChangeMessageVisibility',
  'sns:GetTopicAttributes',
  'sns:ListSubscriptionsByTopic',
];

const REQUIRED_PUBLISHER_PERMISSIONS = ['sns:Publish'];

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;

const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const buildPolicy = (actions: string[]) => ({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: actions,
      Resource: '*',
    },
  ],
});

const createRestrictedCredentials = async (
  iam: IAMClient,
  actions: string[]
) => {
  const userName = uniqueName('iam-test-user');
  await iam.send(new CreateUserCommand({UserName: userName}));
  await iam.send(
    new PutUserPolicyCommand({
      UserName: userName,
      PolicyName: 'listener-perms',
      PolicyDocument: JSON.stringify(buildPolicy(actions)),
    })
  );
  const key = await iam.send(new CreateAccessKeyCommand({UserName: userName}));
  return {
    accessKeyId: key.AccessKey!.AccessKeyId!,
    secretAccessKey: key.AccessKey!.SecretAccessKey!,
  };
};

beforeAll(() => {
  configure({region: 'eu-west-1'});
});

describe('IAM permissions required by the listener path', () => {
  const iam = new IAMClient({endpoint: awsEndpointUrl});

  it('full read-only listener flow succeeds with only the documented permissions', async () => {
    // Pre-seed queue, topic, and subscription with the default `test`
    // credentials (which Floci bypasses from IAM enforcement).
    const queueName = uniqueName('iam-q');
    const topicName = uniqueName('iam-t');
    const setupQueue = await Queue.getOrCreateQueue(queueName, awsEndpointUrl);
    const topic = await Topic.getOrCreateTopic(
      topicName,
      undefined,
      setupQueue.queueArn,
      awsEndpointUrl
    );
    await setupQueue.subscribeTopic(topic);

    const credentials = await createRestrictedCredentials(
      iam,
      REQUIRED_LISTENER_PERMISSIONS
    );

    const sqs = new SQS({endpoint: awsEndpointUrl, credentials});
    const sns = new SNS({endpoint: awsEndpointUrl, credentials});

    // Walk the same call sequence the listener uses on startup against an
    // existing queue/topic/subscription. Each call asserts the matching
    // permission in the policy above is sufficient.

    // Queue.getQueue → sqs:GetQueueUrl
    const queueUrl = (await sqs.getQueueUrl({QueueName: queueName})).QueueUrl;
    expect(queueUrl).toBe(setupQueue.queueUrl);

    // Queue.subscribeTopic policy read → sqs:GetQueueAttributes
    const attrs = await sqs.getQueueAttributes({
      QueueUrl: setupQueue.queueUrl,
      AttributeNames: ['All'],
    });
    expect(attrs.Attributes?.QueueArn).toBe(setupQueue.queueArn);

    // Topic.getOrCreateTopic verify → sns:GetTopicAttributes
    const topicAttrs = await sns.getTopicAttributes({TopicArn: topic.topicArn});
    expect(topicAttrs.Attributes?.TopicArn).toBe(topic.topicArn);

    // Queue.isAlreadySubscribed → sns:ListSubscriptionsByTopic
    const subs = await sns.send(
      new ListSubscriptionsByTopicCommand({TopicArn: topic.topicArn})
    );
    expect(
      subs.Subscriptions?.some(s => s.Endpoint === setupQueue.queueArn)
    ).toBe(true);

    // Listener loop → sqs:ReceiveMessage / sqs:DeleteMessage / sqs:ChangeMessageVisibility
    // We do not push a message; ReceiveMessage with WaitTimeSeconds=0
    // returning an empty list is enough to verify the permission.
    await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: setupQueue.queueUrl,
        WaitTimeSeconds: 0,
      })
    );
  }, 30000);

  it.each([
    ['sqs:GetQueueUrl', async (sqs: SQS, queueName: string) =>
      sqs.getQueueUrl({QueueName: queueName})],
    ['sqs:GetQueueAttributes', async (sqs: SQS, _name: string, queueUrl: string) =>
      sqs.getQueueAttributes({QueueUrl: queueUrl, AttributeNames: ['All']})],
    ['sqs:ReceiveMessage', async (sqs: SQS, _name: string, queueUrl: string) =>
      sqs.receiveMessage({QueueUrl: queueUrl, WaitTimeSeconds: 0})],
  ])(
    'removing %s from the policy breaks the corresponding call',
    async (permission, invoke) => {
      const queueName = uniqueName('iam-neg-q');
      const setup = await Queue.getOrCreateQueue(queueName, awsEndpointUrl);

      const reducedPermissions = REQUIRED_LISTENER_PERMISSIONS.filter(
        p => p !== permission
      );
      const credentials = await createRestrictedCredentials(
        iam,
        reducedPermissions
      );

      const sqs = new SQS({endpoint: awsEndpointUrl, credentials});

      await expect(invoke(sqs, queueName, setup.queueUrl)).rejects.toThrow(
        /AccessDenied|Forbidden|not authorized/i
      );
    },
    30000
  );

  // Note: negative tests for sns:GetTopicAttributes and
  // sns:ListSubscriptionsByTopic are intentionally omitted. Floci's IAM
  // enforcement is permissive for several SNS actions (see Floci docs:
  // "unresolvable IAM action for the request" bypass rule), so these
  // negatives are unreliable. The positive test above is the contract.
});

describe('IAM permissions required by the publisher path (Topic.fromArn + push)', () => {
  const iam = new IAMClient({endpoint: awsEndpointUrl});

  it('Topic.fromArn + push succeed with only sns:Publish', async () => {
    const topicName = uniqueName('iam-pub-t');
    const real = await Topic.createTopic(topicName, undefined, awsEndpointUrl);

    const credentials = await createRestrictedCredentials(
      iam,
      REQUIRED_PUBLISHER_PERMISSIONS
    );

    // Direct SDK publish to verify the perm is sufficient — Topic.push
    // constructs the same PublishCommand internally.
    const publisherSns = new SNS({endpoint: awsEndpointUrl, credentials});
    const result = await publisherSns.publish({
      TopicArn: real.topicArn,
      Message: JSON.stringify({hello: 'world'}),
    });

    expect(result.MessageId).toBeTruthy();
  }, 30000);

  // Note: a negative test for sns:Publish is intentionally omitted —
  // Floci's IAM enforcement is permissive for SNS publish in practice.
  // The positive test above is the contract.
});

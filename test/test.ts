import {
  Queue,
  QueueSubjectListener,
  QueueSubjectListenerBuilder,
  Topic,
  configure,
  getLambdaFunc,
  getSecret,
} from '../src';


const localstackEndpoint =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';

beforeAll(async () => {
  configure({region: 'eu-west-1'});
});

it('should be able to assign several topics to builderer', () => {
  const builder = new QueueSubjectListenerBuilder(
    'test-queueName',
    null,
    {name: 'test', subject: 'test'},
    {name: 'test2', subject: 'test2'}
  );
  expect(builder.topics.length).toBe(2);
});

describe('QueueSubjectListener', () => {
  it('should be able to listen to queue and call handler', async () => {
    const queueName = 'test-queueName';
    const subjectName = 'test_subject';
    const topicName = 'test_topic';
    const queue = await Queue.createQueue(queueName, localstackEndpoint);
    const listener = new QueueSubjectListener(queue, null, {
      maxConcurrentMessage: 1,
      visibilityTimeout: 1,
      waitTimeSeconds: 1,
    });

    const handler = jest.fn(() => Promise.resolve());

    listener.onSubject(subjectName, handler);

    listener.listen();

    const topic = await Topic.createTopic(
      topicName,
      subjectName,
      localstackEndpoint
    );
    await queue.subscribeTopic(topic);
    const event = {id: '123', test: 'test'};
    await topic.push(event);

    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event, subjectName);

    listener.stop();
  });

  it('should be able to listen to queue and call handler with retry', async () => {
    const queueName = 'test-retry-queueName';
    const subjectName = 'test_retry_subject';
    const topicName = 'test_retry_topic';
    const queue = await Queue.createQueue(queueName, localstackEndpoint);
    const listener = new QueueSubjectListener(queue, null, {
      maxConcurrentMessage: 1,
      visibilityTimeout: 0,
      waitTimeSeconds: 0,
    });

    const handler = jest.fn(() => Promise.reject('error'));

    listener.onSubject(subjectName, handler, {
      maxAttempts: 2,
      backoffDelaySeconds: 0,
    });

    listener.listen();

    const topic = await Topic.createTopic(
      topicName,
      subjectName,
      localstackEndpoint
    );
    await queue.subscribeTopic(topic);
    const event = {id: '123', test: 'test'};
    await topic.push(event);

    await new Promise(resolve => setTimeout(resolve, 4000));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(event, subjectName);

    listener.stop();
  }, 10000);
});

it('should run lambda func', async () => {
  /*
  lambda source is in test/lambda/index.js
zip function.zip index.js
awslocal lambda create-function \
    --function-name localstack-lambda-url-example \
    --runtime nodejs18.x \
    --zip-file fileb://function.zip \
    --handler index.handler \
    --role arn:aws:iam::000000000000:role/lambda-role
 */
  const func = getLambdaFunc(
    'localstack-lambda-url-example',
    localstackEndpoint
  );
  const payload = {num1: 324, num2: 36};

  const res = await func(JSON.stringify(payload));

  expect(res).toBeTruthy();
  expect(res).toEqual({
    statusCode: 200,
    body: `The product of ${payload.num1} and ${payload.num2} is ${
      payload.num1 * payload.num2
    }`,
  });
});

it('getSecret', async () => {
  //aws --profile localstack secretsmanager create-secret --name my-secret --secret-string '{"PG_PASSWORD":"stacy"}'
  const res = getSecret('my-secret', 'PG_PASSWORD', localstackEndpoint);
  expect(res).toEqual('stacy');
});

it('should be able to send message to queue', async () => {
  const queue = await Queue.createQueue(
    'test-tibber-aws-queue',
    localstackEndpoint
  );
  const res = await queue.send('Test', {property: 'test'});

  expect(res).toBeTruthy();
  expect(res.MessageId).toBeTruthy();
});

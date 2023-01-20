import rand from 'randomstring';
import {Readable} from 'stream';
import {QueueSubjectListenerBuilder, S3Bucket, configure} from '../src';

configure({region: 'eu-west-1'});

const testBucketName = 'tibber-tibber-ftw-123321';

describe('getOrCreateBucket', () => {
  it('should be able to create bucket', async () => {
    const result = await S3Bucket.getOrCreateBucket(testBucketName);
    expect(typeof result).toBe('object');
  });
});

describe('getBuckets', () => {
  it('getBuckets should return array', async () => {
    const result = await S3Bucket.getBuckets();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('getExistingBucket', () => {
  it('should get bucket if it already exists', async () => {
    const result = await S3Bucket.getExistingBucket(testBucketName);
    const result2 = await S3Bucket.getExistingBucket(testBucketName);
    expect(result?.name).toBe(result2?.name);
  });

  it('should be able to put object without content type', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    bucket!.putObject('test', buffer);
  });

  it('should be able to put object with content type', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
  });

  it('should be able to retrieve object', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    await bucket!.getObject('test');
  });

  it('should be able to retrieve object as stream', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    const result = bucket!.getObjectAsStream('test');
    expect(result.createReadStream).toBeTruthy();
  });

  it('should be able to retrieve object as stream 2', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    const result = await bucket!.getObjectStream('test');
    expect(result).toBeInstanceOf(Readable);
  });

  it('should be able to handle missing key exception', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);
    const name = rand.generate();

    try {
      await bucket!.getObjectStream(name);
    } catch (error) {
      expect(error.message).toBe('Object not available');
    }
  });

  it('should be able to check whether object is available in S3', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);

    let name = rand.generate();

    await bucket!.putObject(name, buffer, 'image/png');
    let result = await bucket!.objectAvailable(name);
    expect(result).toBe(true);

    name = rand.generate();

    result = await bucket!.objectAvailable(name);
    expect(result).toBe(false);
  });

  it('should be able to list objects', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);

    const res = await bucket!.listObjects();

    const contents = res.Contents ?? [];

    expect(contents.length).toBeGreaterThan(10);
  });

  it('should be able to list objects with prefix', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);

    const res = await bucket?.listObjects('test');

    const contents = res?.Contents ?? [];

    expect(contents).toHaveLength(2);
  });

  it('should be able to list after a given key', async () => {
    const bucket = await S3Bucket.getExistingBucket(testBucketName);

    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test2', buffer);

    const res = await bucket?.listObjects('test', 'test');

    const contents = res?.Contents ?? [];

    expect(contents).toHaveLength(1);
  });
});

it('should be able to assign several topics to builder', () => {
  const builder = new QueueSubjectListenerBuilder(
    'test-queueName',
    null,
    {name: 'test', subject: 'test'},
    {name: 'test2', subject: 'test2'}
  );
  expect(builder.topics.length).toBe(2);
});

// it('should be able to use a custom endpoint for localstack', async () => {
//   const bucket = await S3Bucket.getExistingBucket(
//     testBucketName,
//     'http://localhost:4566/'
//   );
//
//   const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
//   await bucket.putObject('test2', buffer);
//
//   const res = await bucket.listObjects('test', 'test');
//
//   const contents = res.Contents || [];
//
//   expect(contents).toHaveLength(1);
// });

/*
it.only('run lambda func', async t => {

    configure({ region: 'eu-west-1' });
    /* const func = getLambdaFunc('pyml_fit_forecast_model_single_home');

    await func({ homeId: 'bc4cf5b9-4f35-4ce3-83ad-dfe6906e97ba' });

    const lambda = getLambdaFunc('pyml_predict_forecast_single_home');
    const startTime = moment.tz('Europe/Oslo').startOf('day').add(1, 'day');
    const endTime = moment.tz('Europe/Oslo').startOf('day').add(2, 'day');
    const modelType = 'consumption';
    const result = await lambda({ homeId: '14b024f9-1c7f-4b2f-9fc6-6e2b3921d201', startTime, endTime, modelType });

    console.log(result);
});




it.only('getSecret', t=>{

   console.log(getSecret('asdfa', 'connectionStringNodeJs'));

})


it.only('should be able to send message to queue', async t => {

    const queue = await Queue.createQueue('test-tibber-aws-queue');
    console.log(await queue.send('Test', { property: 'test' }));
});

it.only('should be able to assign several topics to builder', async (t) =>{

   try{
       let result = await Promise.all([new Promise((resolve,reject)=> reject('Go fuck yourself')),new Promise((resolve,reject)=>{console.log('ran');resolve("sweet");})]);
       console.log(result);
   }
   catch(err){
       console.log(err);
   }

}); */

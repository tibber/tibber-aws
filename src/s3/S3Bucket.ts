import {
  Bucket,
  ListBucketsCommand,
  PutObjectCommandInput,
  S3,
  BucketAlreadyOwnedByYou,
} from '@aws-sdk/client-s3';

export class S3Bucket {
  public name: string;
  public creationDate: Date;
  private s3: S3;
  constructor(
    bucket: Bucket,
    public endpoint?: string
  ) {
    if (bucket.Name === undefined)
      throw Error("Property 'Name' on 'bucket' was undefined.");

    if (bucket.CreationDate === undefined)
      throw Error("Property 'CreationDate' on 'bucket' was undefined.");

    this.name = bucket.Name;
    this.creationDate = bucket.CreationDate;
    this.s3 = new S3({
      apiVersion: '2006-03-01',
      endpoint: this.endpoint,
      forcePathStyle: !!endpoint,
    });
  }

  static async getExistingBucket(bucketName: string, endpoint?: string) {
    const buckets = await S3Bucket.getBuckets(endpoint);
    return buckets.find(b => b.name === bucketName);
  }

  static async getOrCreateBucket(bucketName: string, endpoint?: string) {
    try {
      const s3 = new S3({
        apiVersion: '2006-03-01',
        endpoint,
        forcePathStyle: !!endpoint,
      });
      await s3.createBucket({Bucket: bucketName});

      return new S3Bucket(
        {
          CreationDate: new Date(Date.now()),
          Name: bucketName,
        },
        endpoint
      );
    } catch (err) {
      if (err instanceof BucketAlreadyOwnedByYou) {
        return (await S3Bucket.getBuckets(endpoint)).find(
          b => b.name === bucketName
        );
      }
      throw err;
    }
  }

  static async getBuckets(endpoint?: string) {
    try {
      const result = await new S3({
        apiVersion: '2006-03-01',
        endpoint,
        forcePathStyle: !!endpoint,
      }).listBuckets(new ListBucketsCommand({}));

      if (!result.Buckets)
        throw Error("Property 'Buckets' was undefined on 'result'.");

      return result.Buckets.map(b => new S3Bucket(b));
    } catch (err) {
      return [];
    }
  }

  static async deleteIfExsists(bucketName: string, endpoint?: string) {
    try {
      await new S3({
        apiVersion: '2006-03-01',
        endpoint,
        forcePathStyle: !!endpoint,
      }).deleteBucket({Bucket: bucketName});
      return true;
    } catch (err) {
      return false;
    }
  }

  async putObject(
    key: string,
    body: PutObjectCommandInput['Body'],
    contentType?: PutObjectCommandInput['ContentType']
  ) {
    return await this.s3.putObject({
      Body: body,
      Bucket: this.name,
      ContentType: contentType,
      Key: key,
    });
  }

  async getObject(key: string) {
    return await this.s3.getObject({Bucket: this.name, Key: key});
  }

  getObjectAsStream(key: string) {
    return this.s3.getObject({Bucket: this.name, Key: key});
  }

  async getObjectStream(key: string) {
    if (!(await this.objectAvailable(key))) {
      throw new Error('Object not available');
    }
    return (
      await this.s3.getObject({Bucket: this.name, Key: key})
    ).Body?.transformToWebStream();
  }

  async objectAvailable(key: string) {
    try {
      await this.s3.headObject({Bucket: this.name, Key: key});
      return true;
    } catch (err) {
      return false;
    }
  }

  async listObjects(prefix?: string, startAfter?: string) {
    return await this.s3.listObjectsV2({
      Bucket: this.name,
      Prefix: prefix,
      StartAfter: startAfter,
    });
  }
}

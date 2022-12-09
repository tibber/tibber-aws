import AWS from 'aws-sdk';
import {CreationDate} from 'aws-sdk/clients/s3';

const apiVersion = '2006-03-01';

export class S3Bucket {
  public name: string;
  public creationDate: CreationDate;
  private s3: AWS.S3;
  constructor(private bucket: AWS.S3.Bucket) {
    if (bucket.Name === undefined)
      throw Error("Property 'Name' on 'bucket' was undefined.");

    if (bucket.CreationDate === undefined)
      throw Error("Property 'CreationDate' on 'bucket' was undefined.");

    this.name = bucket.Name;
    this.creationDate = bucket.CreationDate;
    this.s3 = new AWS.S3({apiVersion});
  }

  static async getBucket(bucketName: string) {
    try {
      const s3 = new AWS.S3({apiVersion});
      await s3.createBucket({Bucket: bucketName}).promise();

      return new S3Bucket({
        CreationDate: new Date(Date.now()),
        Name: bucketName,
      });
    } catch (err) {
      if (err.code === 'BucketAlreadyOwnedByYou') {
        return (await S3Bucket.getBuckets()).filter(
          b => b.name === bucketName
        )[0];
      }
      console.log(err);
      throw err;
    }
  }

  static async getBuckets() {
    try {
      const result = await new AWS.S3({apiVersion}).listBuckets().promise();

      if (!result.Buckets)
        throw Error("Property 'Buckets' was undefined on 'result'.");

      return result.Buckets.map(b => new S3Bucket(b));
    } catch (err) {
      return [];
    }
  }

  static async deleteIfExsists(bucketName: string) {
    try {
      await new AWS.S3({apiVersion})
        .deleteBucket({Bucket: bucketName})
        .promise();
      return true;
    } catch (err) {
      return false;
    }
  }

  async putObject(
    key: string,
    body: AWS.S3.PutObjectRequest['Body'],
    contentType?: AWS.S3.PutObjectRequest['ContentType']
  ) {
    return await this.s3
      .putObject({
        Bucket: this.name,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
      .promise();
  }

  async getObject(key: string) {
    return await this.s3.getObject({Bucket: this.name, Key: key}).promise();
  }

  getObjectAsStream(key: string) {
    return this.s3.getObject({Bucket: this.name, Key: key});
  }

  async getObjectStream(key: string) {
    if (!(await this.objectAvailable(key))) {
      throw new Error('Object not available');
    }
    return await this.s3
      .getObject({Bucket: this.name, Key: key})
      .createReadStream();
  }

  async objectAvailable(key: string) {
    try {
      await this.s3.headObject({Bucket: this.name, Key: key}).promise();
      return true;
    } catch (err) {
      return false;
    }
  }

  async listObjects(prefix?: string, startAfter?: string) {
    return await this.s3
      .listObjectsV2({
        Bucket: this.name,
        Prefix: prefix,
        StartAfter: startAfter,
      })
      .promise();
  }
}

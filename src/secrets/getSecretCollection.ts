import AWS from 'aws-sdk';
const rpc = require('sync-rpc');
import {SyncSecretsResolved} from './types';

const cache: Record<string, unknown> = {};

export const getSecretCollection = function <TData = Record<string, string>>(
  secretName: string
): TData | undefined {
  if (cache[secretName]) return cache[secretName] as TData;

  try {
    const client: SyncSecretsResolved = rpc(__dirname + '/syncSecrets.js');
    const secretString = client({
      region: AWS.config.region,
      secret: secretName,
    }).SecretString;

    if (!secretString)
      throw Error("Property 'SecretString' on client response was undefined.");

    const data = JSON.parse(secretString);
    cache[secretName] = data;

    return data;
  } catch (err) {
    console.log(err);
    return undefined;
  }
};

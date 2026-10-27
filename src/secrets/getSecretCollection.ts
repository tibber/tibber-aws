import {execFileSync} from 'child_process';
import {SyncSecretsRequest} from './types';

const cache: Record<string, unknown> = {};

export const getSecretCollection = function <TData = Record<string, string>>(
  secretName: string,
  endpoint?: string
): TData | undefined {
  if (cache[secretName]) return cache[secretName] as TData;

  try {
    const request: SyncSecretsRequest = {
      region: process.env.AWS_REGION,
      secret: secretName,
      endpoint,
    };
    const secretString = execFileSync(
      process.execPath,
      [__dirname + '/syncSecrets.js', JSON.stringify(request)],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}
    );

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

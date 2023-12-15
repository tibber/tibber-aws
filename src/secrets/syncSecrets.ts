import {SecretsManager} from '@aws-sdk/client-secrets-manager';
import {SyncSecretsInit} from './types';

const init: SyncSecretsInit = () => {
  return request => {
    const client = new SecretsManager({
      region: request.region,
      endpoint: request.endpoint,
    });
    return client.getSecretValue({SecretId: request.secret});
  };
};

// noinspection JSUnusedGlobalSymbols
/**
 * This file is executed out-of-proc by sync-rpc in 'getSecretCollection.ts'.
 * The default export is important, and should not be removed;
 */
export default init;

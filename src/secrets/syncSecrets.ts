import {SecretsManager} from '@aws-sdk/client-secrets-manager';
import {clientConfig} from '../clientConfig';
import {SyncSecretsInit} from './types';

const init: SyncSecretsInit = () => {
  return request => {
    const client = new SecretsManager({
      region: request.region,
      ...clientConfig(request.endpoint),
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

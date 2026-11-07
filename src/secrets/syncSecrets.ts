import {SecretsManager} from '@aws-sdk/client-secrets-manager';
import {SyncSecretsRequest} from './types';

// Executed by getSecretCollection as a child process; nothing imports it.
const {region, secret, endpoint}: SyncSecretsRequest = JSON.parse(
  process.argv[2]
);

new SecretsManager({region, endpoint})
  .getSecretValue({SecretId: secret})
  .then(({SecretString}) => process.stdout.write(SecretString ?? ''));

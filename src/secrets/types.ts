import {GetSecretValueCommandOutput} from '@aws-sdk/client-secrets-manager';

export type SyncSecretsRequest = {
  region: undefined | string;
  secret: string;
  endpoint?: string;
};

export type SyncSecretsInit = {
  (): (request: SyncSecretsRequest) => Promise<GetSecretValueCommandOutput>;
};

export type SyncSecretsResolved = {
  (request: SyncSecretsRequest): Awaited<GetSecretValueCommandOutput>;
};

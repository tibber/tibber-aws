import {getSecretCollection} from './getSecretCollection';

export const getSecret = function (
  secretName: string,
  property: string,
  endpoint?: string
): string | undefined {
  const collection = getSecretCollection(secretName, endpoint);
  return collection ? collection[property] : undefined;
};

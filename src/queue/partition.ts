/**
 * Maps an AWS region to its ARN partition (`aws`, `aws-cn`, `aws-us-gov`).
 * Used when deriving an ARN from a region + account + name without making
 * an AWS API call. Tibber does not currently deploy to the non-default
 * partitions, but the helpers in this package are partition-correct so
 * a future deployment there would work without further changes.
 */
export const partitionFromRegion = (region: string): string => {
  if (region.startsWith('cn-')) return 'aws-cn';
  if (region.startsWith('us-gov-')) return 'aws-us-gov';
  return 'aws';
};

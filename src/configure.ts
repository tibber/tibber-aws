import AWS from 'aws-sdk';

type Configure = {
  (args: {region: string}): void;
  (args: {endpoint: string}): void;
};

export const configure: Configure = ({region, endpoint}) => {
  AWS.config.region = region;
  AWS.config.endpoint = endpoint;
  process.env.AWS_REGION = region;
};

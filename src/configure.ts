import AWS from 'aws-sdk';

type Configure = {
  (args: {region: string}): void;
};

export const configure: Configure = ({region}) => {
  AWS.config.region = region;
  process.env.AWS_REGION = region;
};

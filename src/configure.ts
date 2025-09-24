type Configure = {
  (args: {region: string}): void;
};

export const configure: Configure = ({region}) => {
  //TODO: This needs to work as before. Need to read up on how to do this in sdk v3
  process.env.AWS_REGION = region;
};

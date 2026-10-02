const EMULATOR_CREDENTIALS = {
  accessKeyId: 'emulator',
  secretAccessKey: 'emulator',
};

export const emulatorUrl = (endpoint?: string) =>
  endpoint || process.env.AWS_SERVICE_URL;

export const clientConfig = (endpoint?: string) => {
  const url = emulatorUrl(endpoint);
  return url
    ? {
        endpoint: url,
        region: process.env.AWS_REGION ?? 'us-east-1',
        credentials: EMULATOR_CREDENTIALS,
      }
    : {};
};

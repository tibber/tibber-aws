export const clientConfig = (endpoint = process.env.AWS_SERVICE_URL) =>
  endpoint
    ? {
        endpoint,
        region: process.env.AWS_REGION ?? 'us-east-1',
        credentials: {accessKeyId: 'emulator', secretAccessKey: 'emulator'},
      }
    : {};

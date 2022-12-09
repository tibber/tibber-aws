module.exports = {
  services: ['s3'],
  showLog: true,
  readyTimeout: 10000,
  autoPullImage: true,
  S3Buckets: [
    {
      Bucket: 'tibber-tibber-ftw-123321',
    },
  ],
};

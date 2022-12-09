module.exports = {
  services: ['s3'],
  showLog: false,
  readyTimeout: 10000,
  autoPullImage: true,
  S3Buckets: [
    {
      Bucket: 'tibber-tibber-ftw-123321',
    },
  ],
};

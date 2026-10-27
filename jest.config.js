Object.assign(process.env, {
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  AWS_REGION: 'eu-west-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
});
delete process.env.AWS_PROFILE;
delete process.env.AWS_SESSION_TOKEN;

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/dist/test/*test.js'],
};

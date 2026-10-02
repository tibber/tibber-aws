import {clientConfig} from '../src/clientConfig';

const env = {...process.env};

afterEach(() => {
  process.env = {...env};
});

describe('clientConfig', () => {
  it.each([
    ['nothing is configured', {}],
    ['only AWS_ENDPOINT_URL is set', {AWS_ENDPOINT_URL: 'http://localhost:4566'}],
  ])('leaves the SDK defaults alone when %s', (_, vars) => {
    process.env = {...vars};
    expect(clientConfig()).toEqual({});
  });

  it.each([
    ['AWS_SERVICE_URL', undefined, 'http://localhost:4566'],
    ['an explicit endpoint', 'http://floci:4566', 'http://floci:4566'],
  ])('routes to the emulator with %s', (_, endpoint, expected) => {
    process.env = {AWS_SERVICE_URL: 'http://localhost:4566'};
    expect(clientConfig(endpoint)).toEqual({
      endpoint: expected,
      region: 'us-east-1',
      credentials: {accessKeyId: 'emulator', secretAccessKey: 'emulator'},
    });
  });

  it('keeps AWS_REGION when it is set', () => {
    process.env = {AWS_SERVICE_URL: 'http://localhost:4566', AWS_REGION: 'eu-west-1'};
    expect(clientConfig()).toMatchObject({region: 'eu-west-1'});
  });
});

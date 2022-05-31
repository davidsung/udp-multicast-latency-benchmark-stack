import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AeronMulticastStack } from '../src/main';

test('Snapshot', () => {
  const app = new App();
  const stack = new AeronMulticastStack(app, 'test', {
    env: {
      account: '123456789012',
      region: 'dummy-region-a',
    },
  });

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});
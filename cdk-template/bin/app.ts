#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WebSocketApiStack } from '../lib/websocket-api-stack';

const app = new cdk.App();

// Get environment from context or use 'dev' as default
const envName = app.node.tryGetContext('environment') || 'dev';
const awsAccount = process.env.CDK_DEFAULT_ACCOUNT;
const awsRegion = process.env.CDK_DEFAULT_REGION || 'us-east-1';

new WebSocketApiStack(app, `WebSocketApiStack-${envName}`, {
  stackName: `websocket-api-${envName}`,
  description: `WebSocket API infrastructure for ${envName} environment`,

  env: {
    account: awsAccount,
    region: awsRegion,
  },

  // Stack-specific configuration
  environmentName: envName,

  // Uncomment and customize as needed:
  // instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
  // createVpc: true,
  // vpcId: 'vpc-xxxxx', // if using existing VPC

  tags: {
    Environment: envName,
    Project: 'WebSocketApi',
    ManagedBy: 'CDK',
  },
});

app.synth();

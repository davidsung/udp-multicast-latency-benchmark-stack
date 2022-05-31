import { App, CfnOutput, Stack, StackProps, aws_ec2 as ec2, aws_s3 as s3 } from 'aws-cdk-lib';

import { Construct } from 'constructs';

import * as aeron from './aeron-cluster';
import * as transitGateway from './transit-gateway-multicast';

const AERON_INSTANCE_COUNT = 3;
const AERON_INSTANCE_CLASS = ec2.InstanceClass.M5DN;
const AERON_INSTANCE_SIZE = ec2.InstanceSize.XLARGE24;
const MULTICASTGROUP_IP_PING_1 = '239.255.0.1/32';
const MULTICASTGROUP_IP_PING_2 = '239.255.0.2/32';
const MULTICASTGROUP_PORT_PING = 20123;
const MULTICASTGROUP_IP_PONG_1 = '239.255.0.3/32';
const MULTICASTGROUP_IP_PONG_2 = '239.255.0.4/32';
const MULTICASTGROUP_PORT_PONG = 20124;

export class AeronMulticastStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'VpcFlowLogsBucket');
    const vpc = new ec2.Vpc(this, 'VPC', {
      cidr: '10.0.0.0/16',
      subnetConfiguration: [
        {
          name: 'Ingress',
          cidrMask: 24,
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'Control',
          cidrMask: 24,
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        {
          name: 'Data',
          cidrMask: 24,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });
    vpc.addFlowLog('FlowLogS3', {
      destination: ec2.FlowLogDestination.toS3(bucket),
    });
    vpc.addInterfaceEndpoint('SsmEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
    });
    vpc.addInterfaceEndpoint('SsmMessagesEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
    });
    vpc.addInterfaceEndpoint('Ec2MessagesEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
    });

    const tgw = new transitGateway.TransitGatewayMulticast(this, 'AeronMulticast', {
      vpc: vpc,
      subnetIds: vpc.selectSubnets({
        subnetGroupName: 'Data',
      }).subnetIds,
      multicastSupport: true,
      multicastDomainIgmpv2Support: true,
    });

    const cluster = new aeron.AeronCluster(this, 'AeronCluster', {
      vpc,
      controlVpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        availabilityZones: [Stack.of(this).availabilityZones[0]],
      }),
      dataVpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        availabilityZones: [Stack.of(this).availabilityZones[0]],
      }),
      placementGroupStrategy: aeron.PlacementGroupStrategy.CLUSTER,
      instanceType: ec2.InstanceType.of(AERON_INSTANCE_CLASS, AERON_INSTANCE_SIZE),
      instanceCount: AERON_INSTANCE_COUNT,
      multicastGroups: [
        {
          cidrIp: MULTICASTGROUP_IP_PING_1,
          udpPort: MULTICASTGROUP_PORT_PING,
        },
        {
          cidrIp: MULTICASTGROUP_IP_PING_2,
          udpPort: MULTICASTGROUP_PORT_PING,
        },
        {
          cidrIp: MULTICASTGROUP_IP_PONG_1,
          udpPort: MULTICASTGROUP_PORT_PONG,
        },
        {
          cidrIp: MULTICASTGROUP_IP_PONG_2,
          udpPort: MULTICASTGROUP_PORT_PONG,
        },
      ],
    });

    new CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
    });
    new CfnOutput(this, 'VpcFlowlogsBucket', {
      value: bucket.bucketName,
    });
    new CfnOutput(this, 'TransitGatewayId', {
      value: tgw.tgw.attrId,
    });
    new CfnOutput(this, 'ClusterInstanceIds', {
      value: cluster.instances.map(instance => instance.instanceId).join(),
    });
    new CfnOutput(this, 'ClusterInstanceIps', {
      value: cluster.instances.map(instance => instance.instancePrivateIp).join(),
    });
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new AeronMulticastStack(app, 'aeron-multicast-stack-dev', { env: devEnv });

app.synth();
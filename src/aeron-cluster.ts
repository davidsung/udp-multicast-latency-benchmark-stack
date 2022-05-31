import * as fs from 'fs';
import { aws_ec2 as ec2, aws_iam as iam } from 'aws-cdk-lib';

import { OperatingSystemType } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export enum PlacementGroupStrategy {
  CLUSTER,
  SPREAD,
  PARITION,
}

export interface AeronMulticastGroup {
  readonly cidrIp: string;
  readonly udpPort: number;
}

export interface AeronClusterProps {
  readonly vpc: ec2.IVpc;
  readonly controlVpcSubnets?: ec2.SubnetSelection;
  readonly dataVpcSubnets?: ec2.SubnetSelection;
  readonly availabilityZone?: string;
  readonly securityGroup?: ec2.ISecurityGroup;
  readonly instanceCount?: number;
  readonly instanceType?: ec2.InstanceType;
  readonly machineImage?: ec2.IMachineImage;
  readonly role?: iam.IRole;
  readonly placementGroupStrategy?: PlacementGroupStrategy;
  readonly multicastGroups?: AeronMulticastGroup[];
}

export class AeronCluster extends Construct {

  readonly instances: ec2.Instance[];

  constructor(scope: Construct, id: string, props: AeronClusterProps) {
    super(scope, id);

    this.instances = new Array();

    const controlSg = new ec2.SecurityGroup(this, 'AeronControlSecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: false,
      description: 'Security group for Control Traffic of Aeron Cluster',
    });

    const dataSg = new ec2.SecurityGroup(this, 'AeronDataSecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: false,
      description: 'Security group for Data Traffic of Aeron Cluster',
    });

    const efaSg = new ec2.SecurityGroup(this, 'AeronEfaSecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: false,
      description: 'Security group for EFA Data Traffic of Aeron Cluster',
    });

    // Security Group Configuration Reference: https://docs.aws.amazon.com/vpc/latest/tgw/how-multicast-works.html
    // IGMP Multicast
    dataSg.addIngressRule(
      ec2.Peer.ipv4('0.0.0.0/32'),
      new ec2.Port({
        protocol: ec2.Protocol.IGMP,
        stringRepresentation: 'IGMP query',
      }),
      'IGMP query',
    );

    // Allow outbound IGMP query
    dataSg.addEgressRule(
      ec2.Peer.ipv4('224.0.0.2/32'),
      new ec2.Port({
        protocol: ec2.Protocol.IGMP,
        stringRepresentation: 'IGMP query',
      }),
      'IGMP leave',
    );

    props.multicastGroups?.forEach(multicastGroup => {
      // Inbound multicast
      dataSg.addIngressRule(
        ec2.Peer.ipv4(multicastGroup.cidrIp),
        ec2.Port.udp(multicastGroup.udpPort),
        `Inbound UDP Port ${multicastGroup.udpPort} from multicast group`,
      );

      dataSg.addEgressRule(
        ec2.Peer.ipv4(multicastGroup.cidrIp),
        new ec2.Port({
          protocol: ec2.Protocol.IGMP,
          stringRepresentation: 'IGMP query',
        }),
        'IGMP join',
      );

      dataSg.addEgressRule(
        ec2.Peer.ipv4(multicastGroup.cidrIp),
        ec2.Port.udp(multicastGroup.udpPort),
        `IGMP join for UDP Port ${multicastGroup.udpPort}`,
      );

      dataSg.addEgressRule(
        ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
        ec2.Port.udp(multicastGroup.udpPort),
        `Allow UDP ${multicastGroup.udpPort} outbound to VPC CIDR`,
      );
    });

    // Iterate all unique port specified in props.multicastGroups
    // add Ingress Rule to allow the unique UDP port from VPC CIDR
    // add Egress Rule to allow the unique UDP port to VPC CIDR
    props.multicastGroups?.map(mcastGroup => mcastGroup.udpPort)
      .filter((v, i, a) => a.indexOf(v) === i)
      .forEach(port => {
        dataSg.addIngressRule(
          ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
          ec2.Port.udp(port),
          `Allow UDP ${port} inbound from VPC CIDR`,
        );

        dataSg.addEgressRule(
          ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
          ec2.Port.udp(port),
          `Allow UDP ${port} outbound to VPC CIDR`,
        );
      });

    // Allow ICMP Ingress from the same security group
    controlSg.addIngressRule(
      controlSg,
      ec2.Port.allIcmp(),
      'Allow all ICMP from this security group',
    );

    // Allow ICMP Egress to the same security group
    controlSg.addEgressRule(
      controlSg,
      ec2.Port.allIcmp(),
      'Allow all ICMP to this security group',
    );

    // Allow http and https outbound to anywhere
    controlSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow http egress to any',
    );

    controlSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow https egress to any',
    );

    // EFA Security Group
    efaSg.addIngressRule(
      efaSg,
      ec2.Port.allTraffic(),
      'Allow all inbound traffic from to security group',
    );
    efaSg.addEgressRule(
      efaSg,
      ec2.Port.allTraffic(),
      'Allow all outbound traffic from this security group',
    );

    let pg;
    if (props.placementGroupStrategy) {
      pg = new ec2.CfnPlacementGroup(this, 'PlacementGroup', {
        strategy: PlacementGroupStrategy[props.placementGroupStrategy].toLowerCase(),
      });
    }

    const machineImage = ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/focal/stable/current/amd64/hvm/ebs-gp2/ami-id',
      {
        os: OperatingSystemType.LINUX,
      },
    );

    for (let count = 0; count < (props.instanceCount ?? 1); count++) {
      const host = new ec2.Instance(this, `Instance${count}`, {
        vpc: props.vpc,
        instanceType: props.instanceType ?? ec2.InstanceType.of(ec2.InstanceClass.C5D, ec2.InstanceSize.XLARGE),
        machineImage: props.machineImage ?? machineImage,
        securityGroup: props.securityGroup ?? controlSg,
        vpcSubnets: props.controlVpcSubnets,
      });
      host.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'ssmmessages:*',
          'ssm:UpdateInstanceInformation',
          'ec2messages:*',
        ],
        resources: ['*'],
      }));
      host.addUserData(
        fs.readFileSync('lib/user-data-ubuntu.sh', 'utf8'),
      );

      const { subnets } = props.vpc.selectSubnets(props.dataVpcSubnets);
      let subnet;
      if (props.availabilityZone) {
        const selected = subnets.filter(sn => sn.availabilityZone === props.availabilityZone);
        if (selected.length === 1) {
          subnet = selected[0];
        }
      } else {
        if (subnets.length > 0) {
          subnet = subnets[0];
        }
      }
      if (!subnet) {
        subnet = ec2.Subnet.fromSubnetAttributes(this, `DummySubnet/${count}`, {
          subnetId: 's-notfound',
          availabilityZone: 'az-notfound',
        });
      }
      const eni = new ec2.CfnNetworkInterface(this, `AeronTrafficNetworkInterface/${count}`, {
        subnetId: subnet.subnetId,
        description: 'Dedicated Interface for Aeron Traffic',
        groupSet: [dataSg.securityGroupId],
        tags: [{
          key: 'Name',
          value: 'aeron-data-network-interface',
        }],
      });
      new ec2.CfnNetworkInterfaceAttachment(this, `AeronTrafficNetworkInterfaceAttachment/${count}`, {
        instanceId: host.instanceId,
        networkInterfaceId: eni.getAtt('Id').toString(),
        deviceIndex: '1',
      });

      new ec2.CfnNetworkInterface(this, `EfaTrafficNetworkInterface${count}`, {
        subnetId: subnet.subnetId,
        description: 'EFA interface for Aeron Traffic',
        groupSet: [efaSg.securityGroupId],
        interfaceType: 'efa',
        tags: [{
          key: 'Name',
          value: 'aeron-data-efa',
        }],
      });
      // new ec2.CfnNetworkInterfaceAttachment(this, `EfaTrafficNetworkInterfaceAttachment${count}`, {
      //   instanceId: host.instanceId,
      //   networkInterfaceId: efa.getAtt('Id').toString(),
      //   deviceIndex: '2',
      // });

      if (pg) {
        host.instance.addPropertyOverride('PlacementGroupName', pg.ref);
      }

      this.instances.push(host);
    }
  }
}
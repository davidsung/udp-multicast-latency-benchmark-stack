import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface TransitGatewayMulticastProps {
  readonly vpc: ec2.Vpc;
  readonly subnetIds: string[];
  readonly amazonSideAsn?: number;
  readonly associationDefaultRouteTableId?: string;
  readonly autoAcceptSharedAttachments?: boolean;
  readonly defaultRouteTableAssociation?: boolean;
  readonly defaultRouteTablePropagation?: boolean;
  readonly description?: string;
  readonly dnsSupport?: boolean;
  readonly propagationDefaultRouteTableId?: string;
  tags?: {
    key: string;
    value: string;
  }[];
  readonly transitGatewayCidrBlocks?: string[];
  readonly vpnEcmpSupport?: boolean;
  readonly multicastSupport?: boolean;
  readonly multicastDomainAutoAcceptSharedAssociations?: boolean;
  readonly multicastDomainIgmpv2Support?: boolean;
  readonly multicastDomainStaticSourcesSupport?: boolean;
}

export class TransitGatewayMulticast extends Construct {
  readonly tgw: ec2.CfnTransitGateway;

  constructor(scope: Construct, id: string, props: TransitGatewayMulticastProps) {
    super(scope, id);

    this.tgw = new ec2.CfnTransitGateway(this, `${id}/TransitGateway`, {
      amazonSideAsn: props.amazonSideAsn,
      associationDefaultRouteTableId: props.associationDefaultRouteTableId,
      autoAcceptSharedAttachments: props.autoAcceptSharedAttachments ? 'enable' : 'disable',
      defaultRouteTableAssociation: props.defaultRouteTableAssociation ? 'enable' : 'disable',
      defaultRouteTablePropagation: props.defaultRouteTablePropagation ? 'enable' : 'disable',
      description: props.description,
      dnsSupport: props.dnsSupport ? 'enable' : 'disable',
      multicastSupport: props.multicastSupport ? 'enable' : 'disable',
      propagationDefaultRouteTableId: props.propagationDefaultRouteTableId,
      tags: props.tags,
      transitGatewayCidrBlocks: props.transitGatewayCidrBlocks,
      vpnEcmpSupport: props.vpnEcmpSupport ? 'enable' : 'disable',
    });

    const tgwVpcAttachment = new ec2.CfnTransitGatewayVpcAttachment(this, `${id}/TransitGateway/VpcAttachment`, {
      subnetIds: props.subnetIds,
      transitGatewayId: this.tgw.attrId,
      vpcId: props.vpc.vpcId,
    });

    if (props.multicastSupport) {
      const tgwMulticastDomain = new ec2.CfnTransitGatewayMulticastDomain(this, `${id}/TransitGateway/MulticastDomain`, {
        transitGatewayId: this.tgw.attrId,
        options: {
          AutoAcceptSharedAssociations: props.multicastDomainAutoAcceptSharedAssociations ? 'enable' : 'disable',
          Igmpv2Support: props.multicastDomainIgmpv2Support ? 'enable' : 'disable',
          StaticSourcesSupport: props.multicastDomainStaticSourcesSupport ? 'enable' : 'disable',
        },
        tags: props.tags,
      });

      props.subnetIds.forEach((subnetId, i) => {
        new ec2.CfnTransitGatewayMulticastDomainAssociation(this, `${id}/TransitGateway/MulticastDomainAssociation/${i}`, {
          subnetId: subnetId,
          transitGatewayAttachmentId: tgwVpcAttachment.attrId,
          transitGatewayMulticastDomainId: tgwMulticastDomain.attrTransitGatewayMulticastDomainId,
        });
      });
    }
  }
}
#!/bin/bash
# Usage: ./connect.sh [instance index]

aws ssm start-session \
  --target $(aws cloudformation describe-stacks --stack-name aeron-multicast-stack-dev --query "Stacks[0].Outputs" --output json | jq -rc '.[] | select(.OutputKey=="ClusterInstanceIds") | .OutputValue ' | cut -d, -f$1)
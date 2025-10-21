import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';

export interface WebSocketApiStackProps extends cdk.StackProps {
  /**
   * Environment name (e.g., 'dev', 'prod')
   * @default 'dev'
   */
  readonly environmentName?: string;

  /**
   * EC2 instance type
   * @default t3.small
   */
  readonly instanceType?: ec2.InstanceType;

  /**
   * Whether to create a new VPC or use existing
   * @default true (creates new VPC)
   */
  readonly createVpc?: boolean;

  /**
   * Existing VPC ID (if createVpc is false)
   */
  readonly vpcId?: string;
}

export class WebSocketApiStack extends cdk.Stack {
  public readonly albDnsName: string;
  public readonly deploymentBucketName: string;
  public readonly instanceId: string;

  constructor(scope: Construct, id: string, props?: WebSocketApiStackProps) {
    super(scope, id, props);

    const envName = props?.environmentName || 'dev';
    const instanceType = props?.instanceType || ec2.InstanceType.of(
      ec2.InstanceClass.T3,
      ec2.InstanceSize.SMALL
    );

    // ========================================
    // VPC
    // ========================================
    let vpc: ec2.IVpc;

    if (props?.createVpc === false && props.vpcId) {
      // Use existing VPC
      vpc = ec2.Vpc.fromLookup(this, 'ExistingVPC', {
        vpcId: props.vpcId,
      });
    } else {
      // Create new VPC
      vpc = new ec2.Vpc(this, 'WebSocketVPC', {
        vpcName: `websocket-api-vpc-${envName}`,
        maxAzs: 2,
        natGateways: 1,
        subnetConfiguration: [
          {
            cidrMask: 24,
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
          },
          {
            cidrMask: 24,
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
        ],
      });
    }

    // ========================================
    // S3 Deployment Bucket
    // ========================================
    const deploymentBucket = new s3.Bucket(this, 'DeploymentBucket', {
      bucketName: `websocket-api-deployments-${envName}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      lifecycleRules: [
        {
          id: 'DeleteOldDeployments',
          enabled: true,
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    // ========================================
    // IAM Role for EC2
    // ========================================
    const ec2Role = new iam.Role(this, 'EC2Role', {
      roleName: `websocket-api-ec2-role-${envName}`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
      description: 'IAM role for WebSocket API EC2 instance',
    });

    // Grant S3 read access for deployments
    deploymentBucket.grantRead(ec2Role);

    // ========================================
    // Security Groups
    // ========================================

    // ALB Security Group
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      securityGroupName: `websocket-api-alb-sg-${envName}`,
      description: 'Security group for WebSocket API ALB',
      allowAllOutbound: true,
    });

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from anywhere'
    );

    // EC2 Security Group
    const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
      vpc,
      securityGroupName: `websocket-api-ec2-sg-${envName}`,
      description: 'Security group for WebSocket API EC2 instance',
      allowAllOutbound: true,
    });

    ec2SecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(80),
      'Allow traffic from ALB'
    );

    ec2SecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(5000),
      'Allow traffic from ALB to app port'
    );

    // Optional: SSH access (comment out for production)
    // ec2SecurityGroup.addIngressRule(
    //   ec2.Peer.anyIpv4(),
    //   ec2.Port.tcp(22),
    //   'Allow SSH access'
    // );

    // ========================================
    // User Data Script
    // ========================================
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      'exec > >(tee /var/log/user-data.log)',
      'exec 2>&1',
      '',
      'echo "Starting WebSocket API setup at $(date)"',
      '',
      '# Update system',
      'apt-get update -y',
      'apt-get upgrade -y',
      '',
      '# Install dependencies',
      'apt-get install -y awscli unzip nginx curl',
      '',
      '# Install .NET 8 Runtime',
      'wget https://dot.net/v1/dotnet-install.sh -O /tmp/dotnet-install.sh',
      'chmod +x /tmp/dotnet-install.sh',
      '/tmp/dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet',
      'ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet',
      '',
      '# Verify .NET installation',
      'dotnet --version',
      '',
      '# Create application directory',
      'mkdir -p /var/www/websocketapi',
      'chown -R www-data:www-data /var/www/websocketapi',
      '',
      '# Create systemd service',
      'cat > /etc/systemd/system/websocketapi.service <<\'EOF\'',
      '[Unit]',
      'Description=WebSocket API .NET Application',
      'After=network.target',
      '',
      '[Service]',
      'Type=notify',
      'WorkingDirectory=/var/www/websocketapi',
      'ExecStart=/usr/bin/dotnet /var/www/websocketapi/WebSocketApi.dll',
      'Restart=always',
      'RestartSec=10',
      'KillSignal=SIGINT',
      'SyslogIdentifier=websocketapi',
      'User=www-data',
      `Environment=ASPNETCORE_ENVIRONMENT=${envName === 'prod' ? 'Production' : 'Development'}`,
      'Environment=ASPNETCORE_URLS=http://0.0.0.0:5000',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      '',
      'systemctl daemon-reload',
      'systemctl enable websocketapi',
      '',
      '# Configure Nginx as reverse proxy',
      'cat > /etc/nginx/sites-available/websocketapi <<\'EOF\'',
      'upstream websocketapi {',
      '    server 127.0.0.1:5000;',
      '}',
      '',
      'server {',
      '    listen 80 default_server;',
      '    server_name _;',
      '',
      '    location / {',
      '        proxy_pass http://websocketapi;',
      '        proxy_http_version 1.1;',
      '        proxy_set_header Upgrade $http_upgrade;',
      '        proxy_set_header Connection "upgrade";',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '        proxy_cache_bypass $http_upgrade;',
      '        proxy_read_timeout 300s;',
      '        proxy_connect_timeout 75s;',
      '    }',
      '',
      '    location /ws {',
      '        proxy_pass http://websocketapi/ws;',
      '        proxy_http_version 1.1;',
      '        proxy_set_header Upgrade $http_upgrade;',
      '        proxy_set_header Connection "upgrade";',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '        proxy_read_timeout 86400;',
      '    }',
      '',
      '    location /health {',
      '        proxy_pass http://websocketapi/health;',
      '        access_log off;',
      '    }',
      '}',
      'EOF',
      '',
      'ln -sf /etc/nginx/sites-available/websocketapi /etc/nginx/sites-enabled/',
      'rm -f /etc/nginx/sites-enabled/default',
      '',
      'nginx -t',
      'systemctl restart nginx',
      '',
      'echo "WebSocket API setup completed at $(date)"'
    );

    // ========================================
    // EC2 Instance
    // ========================================
    const instance = new ec2.Instance(this, 'WebSocketApiInstance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      instanceType,
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id',
        {
          os: ec2.OperatingSystemType.LINUX,
        }
      ),
      securityGroup: ec2SecurityGroup,
      role: ec2Role,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });

    // Tag the instance
    cdk.Tags.of(instance).add('Name', 'WebSocketApi');
    cdk.Tags.of(instance).add('Environment', envName);
    cdk.Tags.of(instance).add('ManagedBy', 'CDK');

    // ========================================
    // Application Load Balancer
    // ========================================
    const alb = new elbv2.ApplicationLoadBalancer(this, 'WebSocketALB', {
      vpc,
      internetFacing: true,
      loadBalancerName: `websocket-api-alb-${envName}`,
      securityGroup: albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // ========================================
    // Target Group
    // ========================================
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetGroupName: `websocket-api-tg-${envName}`,
      targets: [new targets.InstanceTarget(instance, 80)],
      healthCheck: {
        enabled: true,
        path: '/health',
        protocol: elbv2.Protocol.HTTP,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: cdk.Duration.seconds(30),
      stickinessCookieDuration: cdk.Duration.hours(1),
    });

    // Enable sticky sessions (required for WebSocket)
    targetGroup.setAttribute('stickiness.enabled', 'true');
    targetGroup.setAttribute('stickiness.type', 'lb_cookie');

    // ========================================
    // ALB Listener
    // ========================================
    alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'Application Load Balancer DNS Name',
      exportName: `WebSocketApi-ALB-DNS-${envName}`,
    });

    new cdk.CfnOutput(this, 'WebSocketURL', {
      value: `ws://${alb.loadBalancerDnsName}/ws`,
      description: 'WebSocket Connection URL',
      exportName: `WebSocketApi-WS-URL-${envName}`,
    });

    new cdk.CfnOutput(this, 'HealthCheckURL', {
      value: `http://${alb.loadBalancerDnsName}/health`,
      description: 'Health Check URL',
    });

    new cdk.CfnOutput(this, 'DeploymentBucket', {
      value: deploymentBucket.bucketName,
      description: 'S3 Deployment Bucket Name',
      exportName: `WebSocketApi-Bucket-${envName}`,
    });

    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'InstanceTag', {
      value: 'WebSocketApi',
      description: 'EC2 Instance Name Tag (for GitHub Actions)',
      exportName: `WebSocketApi-InstanceTag-${envName}`,
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    // Store values for programmatic access
    this.albDnsName = alb.loadBalancerDnsName;
    this.deploymentBucketName = deploymentBucket.bucketName;
    this.instanceId = instance.instanceId;
  }
}

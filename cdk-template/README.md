# WebSocket API Infrastructure (CDK)

This CDK project creates the complete AWS infrastructure for the WebSocket API.

## What Gets Created

- ✅ **VPC** - 2 AZs with public/private subnets
- ✅ **EC2 Instance** - Ubuntu 22.04 with .NET 8 pre-installed
- ✅ **Application Load Balancer** - Public-facing with health checks
- ✅ **Target Group** - With sticky sessions for WebSocket
- ✅ **Security Groups** - ALB and EC2 with proper rules
- ✅ **S3 Bucket** - For application deployments
- ✅ **IAM Roles** - EC2 role with SSM and S3 access
- ✅ **Nginx** - Reverse proxy configured automatically

## Prerequisites

1. AWS CLI configured with credentials
2. Node.js 18+ installed
3. AWS CDK installed globally:
   ```bash
   npm install -g aws-cdk
   ```

## Setup

### 1. Copy to Your Infrastructure Repo

```bash
# In your infrastructure repo
cp -r cdk-template/* .
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Bootstrap CDK (First Time Only)

```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

## Deployment

### Deploy to Dev Environment

```bash
npm run deploy:dev
```

Or:
```bash
cdk deploy --context environment=dev
```

### Deploy to Production Environment

```bash
npm run deploy:prod
```

Or:
```bash
cdk deploy --context environment=prod
```

## After Deployment

You'll see these outputs:

```
Outputs:
WebSocketApiStack-dev.ALBDnsName = my-alb-xxxxx.us-east-1.elb.amazonaws.com
WebSocketApiStack-dev.WebSocketURL = ws://my-alb-xxxxx.us-east-1.elb.amazonaws.com/ws
WebSocketApiStack-dev.HealthCheckURL = http://my-alb-xxxxx.us-east-1.elb.amazonaws.com/health
WebSocketApiStack-dev.DeploymentBucket = websocket-api-deployments-dev-123456789
WebSocketApiStack-dev.InstanceTag = WebSocketApi
WebSocketApiStack-dev.InstanceId = i-xxxxxxxxxxxxx
```

### Use These Values:

1. **For GitHub Actions Secrets:**
   - `S3_DEPLOYMENT_BUCKET` = DeploymentBucket value
   - `EC2_INSTANCE_TAG` = InstanceTag value (WebSocketApi)

2. **For Your Frontend:**
   - WebSocket URL = WebSocketURL output
   - Update your Next.js app to connect to this URL

3. **Test the Deployment:**
   ```bash
   # Test health check
   curl http://YOUR-ALB-DNS/health

   # Should return: Healthy
   ```

## Configuration Options

Edit `bin/app.ts` to customize:

```typescript
new WebSocketApiStack(app, `WebSocketApiStack-${envName}`, {
  environmentName: envName,

  // Change instance type
  instanceType: ec2.InstanceType.of(
    ec2.InstanceClass.T3,
    ec2.InstanceSize.MEDIUM
  ),

  // Use existing VPC instead of creating new one
  // createVpc: false,
  // vpcId: 'vpc-xxxxx',
});
```

## Useful Commands

```bash
# Build TypeScript
npm run build

# Preview changes before deploying
npm run diff

# or
cdk diff --context environment=dev

# Generate CloudFormation template
npm run synth

# Destroy infrastructure (careful!)
npm run destroy
```

## Cost Estimate

**Monthly costs (single environment):**
- EC2 t3.small: ~$15
- ALB: ~$20
- NAT Gateway: ~$32
- S3: ~$1
- **Total: ~$68/month**

**To reduce costs:**
- Remove NAT Gateway (use public subnet for EC2, less secure)
- Use t3.micro instead of t3.small
- Stop EC2 when not in use (dev environment)

## Stack Structure

```
WebSocketApiStack
├── VPC (2 AZs)
│   ├── Public Subnets (ALB)
│   └── Private Subnets (EC2)
├── EC2 Instance
│   ├── Ubuntu 22.04
│   ├── .NET 8 Runtime
│   ├── Nginx
│   └── SystemD Service
├── Application Load Balancer
│   ├── HTTP Listener (Port 80)
│   └── Target Group (Sticky Sessions)
├── S3 Bucket (Deployments)
└── IAM Roles
    ├── EC2 Role (SSM + S3 Read)
    └── Instance Profile
```

## Troubleshooting

### Stack fails to create

```bash
# Check CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name websocket-api-dev \
  --max-items 20
```

### EC2 instance doesn't start app

```bash
# SSH into instance (via Systems Manager)
aws ssm start-session --target i-xxxxxxxxxxxxx

# Check user-data logs
sudo cat /var/log/user-data.log

# Check application service
sudo journalctl -u websocketapi -f
```

### Health check fails

```bash
# SSH into instance
sudo systemctl status websocketapi
sudo systemctl status nginx

# Test locally
curl http://localhost:5000/health
```

## Next Steps

1. ✅ Deploy this CDK stack
2. ✅ Note the outputs (ALB DNS, S3 Bucket, Instance Tag)
3. ✅ Add GitHub secrets to WebSocket API repo
4. ✅ Push code to trigger GitHub Actions deployment
5. ✅ Test WebSocket connection
6. ✅ (Optional) Add SSL certificate for HTTPS/WSS

## Security Notes

- EC2 instances are in private subnets (no direct internet access)
- SSH access is disabled by default (use SSM for access)
- Security groups follow least-privilege principle
- S3 bucket blocks public access
- All traffic goes through ALB (public-facing)

## Adding SSL/HTTPS

See `ALB-SSL-SETUP.md` in the WebSocket API repo for instructions on:
- Requesting SSL certificate via ACM
- Adding HTTPS listener to ALB
- Configuring custom domain
- Enabling WSS (WebSocket Secure)

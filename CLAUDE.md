# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **AWS CDK (Cloud Development Kit) infrastructure-as-code repository** that provisions AWS resources for hosting a .NET WebSocket API. This repository contains ONLY infrastructure code - not the WebSocket application itself. The actual .NET application is deployed separately after the infrastructure is created.

**Key Point:** This is a template meant to be copied into a dedicated infrastructure repository, not used standalone.

## Project Structure

```
WebSocket-Infra/
├── bin/
│   └── app.ts                          # CDK app entry point, instantiates the stack
├── lib/
│   └── websocket-api-stack.ts          # Main stack: VPC, EC2, ALB, S3, IAM, Security Groups
├── .github/workflows/
│   └── cdk-deploy.yml                  # GitHub Actions deployment workflow (CURRENTLY BROKEN)
├── cdk.json                            # CDK configuration
├── package.json                        # Dependencies and npm scripts
└── tsconfig.json                       # TypeScript compiler config
```

## Architecture

The CDK stack creates a complete AWS infrastructure:

1. **VPC** (2 AZs) with public/private subnets and NAT Gateway
2. **EC2 Instance** (Ubuntu 22.04, t3.small) in private subnet
   - Pre-installed: .NET 8 Runtime, Nginx, AWS CLI
   - SystemD service configured for WebSocket app
   - Accessible only via AWS Systems Manager (no SSH)
3. **Application Load Balancer** (public-facing)
   - HTTP listener on port 80
   - Sticky sessions enabled for WebSocket support
   - Health checks against `/health` endpoint
4. **S3 Bucket** for application deployments
5. **Security Groups** with least-privilege rules
6. **IAM Roles** for EC2 (SSM access + S3 read permissions)

**Traffic Flow:**
```
Internet → ALB (public subnet) → EC2 Nginx (private subnet) → .NET App (port 5000)
```

## Multi-Environment Support

The stack supports multiple environments via CDK context:
- `dev` (default)
- `prod`

Environment is passed via: `--context environment=dev`

Stack names are environment-specific: `websocket-api-dev`, `websocket-api-prod`

## Common Commands

### Build and Deploy

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Preview changes before deploying
npm run diff
# or for specific environment:
cdk diff --context environment=dev

# Deploy to dev environment
npm run deploy:dev
# or equivalently:
cdk deploy --context environment=dev

# Deploy to production
npm run deploy:prod
# or equivalently:
cdk deploy --context environment=prod

# Generate CloudFormation template (dry-run)
npm run synth

# Destroy infrastructure (careful!)
npm run destroy
```

### First-Time Setup

```bash
# Bootstrap CDK in your AWS account (one-time only)
cdk bootstrap aws://ACCOUNT-ID/REGION
```

### Troubleshooting

```bash
# Check CloudFormation stack events
aws cloudformation describe-stack-events --stack-name websocket-api-dev --max-items 20

# Connect to EC2 instance (via Systems Manager, SSH is disabled)
aws ssm start-session --target i-xxxxxxxxxxxxx

# On EC2 instance, check logs:
sudo cat /var/log/user-data.log              # User data script execution
sudo journalctl -u websocketapi -f           # WebSocket app service logs
sudo systemctl status websocketapi           # Service status
sudo systemctl status nginx                  # Nginx status

# Test health check locally on EC2
curl http://localhost:5000/health
```

## Stack Configuration

Configuration is done in `bin/app.ts`:

```typescript
new WebSocketApiStack(app, `WebSocketApiStack-${envName}`, {
  environmentName: envName,                   // 'dev' or 'prod'

  // Optional customizations:
  instanceType: ec2.InstanceType.of(          // Change instance size
    ec2.InstanceClass.T3,
    ec2.InstanceSize.MEDIUM
  ),

  // Use existing VPC instead of creating new one:
  // createVpc: false,
  // vpcId: 'vpc-xxxxx',
});
```

## Important Implementation Details

### EC2 User Data Script (lib/websocket-api-stack.ts:167-271)

The EC2 instance runs a comprehensive setup script that:
1. Installs .NET 8 runtime from Microsoft
2. Creates `/var/www/websocketapi` directory
3. Configures SystemD service for the .NET app
4. Sets up Nginx as reverse proxy with WebSocket support
5. Configures proper headers for WebSocket upgrade

**Critical:** The app is NOT deployed by CDK. The infrastructure expects a separate deployment process to copy the .NET application to `/var/www/websocketapi/WebSocketApi.dll`.

### WebSocket Configuration

- **Sticky Sessions:** Enabled on ALB target group (lib/websocket-api-stack.ts:344-345) - required for WebSocket connections
- **Nginx Timeouts:** `/ws` endpoint has 86400s read timeout for long-lived connections (line 254)
- **Health Check:** ALB checks `/health` every 30 seconds (lines 329-338)

### Security

- EC2 instances are in **private subnets** - no direct internet access
- SSH is **disabled by default** (commented out at line 158)
- Access to EC2 only via **AWS Systems Manager** (SSM)
- Security groups follow **least-privilege principle**:
  - ALB accepts HTTP/HTTPS from anywhere (lines 125-135)
  - EC2 only accepts traffic from ALB on ports 80 and 5000 (lines 145-155)
- S3 bucket blocks all public access (line 86)

### Stack Outputs

After deployment, the following values are exported:
- `ALBDnsName` - Load balancer DNS (e.g., my-alb-xxxxx.us-east-1.elb.amazonaws.com)
- `WebSocketURL` - WebSocket connection URL (ws://ALB-DNS/ws)
- `HealthCheckURL` - Health check endpoint
- `DeploymentBucket` - S3 bucket name for app deployments
- `InstanceId` - EC2 instance ID
- `InstanceTag` - Always "WebSocketApi" (used by GitHub Actions to find instance)
- `VpcId` - VPC identifier

These outputs are used to configure the separate application deployment pipeline.

## Known Issues

### GitHub Actions Workflow is Broken

The workflow in `.github/workflows/cdk-deploy.yml` **does not work** with the current project structure:

**Problem:** The workflow runs commands from the repository root, but there's no `package.json` at the root. The CDK code is actually in a `cdk-template/` subdirectory with its own `package.json`.

**Errors that will occur:**
- Line 47: `npm ci` - fails (no package.json at root)
- Line 50: `npm run build` - fails (no package.json at root)
- Lines 68, 72-75: `cdk diff` and `cdk deploy` - fail (wrong directory)

**Fix Required:** Either:
1. Add `working-directory: ./cdk-template` to all workflow steps, OR
2. Move the CDK files from `cdk-template/` to repository root, OR
3. Prefix commands with `cd cdk-template &&`

### Template Directory Structure

Note that there's a `cdk-template/` subdirectory that appears to be a copy/template version of the CDK code. The actual working CDK files are at the repository root. The README.md references copying from `cdk-template/` to another repo, suggesting this repository serves as a template source.

## Cost Estimate

Monthly AWS costs for a single environment (dev or prod):
- EC2 t3.small: ~$15/month
- Application Load Balancer: ~$20/month
- NAT Gateway: ~$32/month
- S3 storage: ~$1/month
- **Total: ~$68/month per environment**

To reduce costs in dev:
- Stop EC2 instance when not in use
- Use t3.micro instead of t3.small
- Consider removing NAT Gateway (requires EC2 in public subnet - less secure)

## Development Workflow

1. Make changes to `lib/websocket-api-stack.ts` or `bin/app.ts`
2. Run `npm run build` to compile TypeScript
3. Run `npm run diff` to preview infrastructure changes
4. Run `npm run deploy:dev` to deploy to dev environment
5. Test the infrastructure with the WebSocket application
6. Deploy to prod when ready: `npm run deploy:prod`

## Integration with Application Deployment

After CDK creates the infrastructure:

1. Note the **DeploymentBucket** and **InstanceTag** outputs
2. Configure application deployment pipeline (separate repo) with these values
3. Application deployment process should:
   - Build the .NET WebSocket application
   - Upload compiled app to S3 deployment bucket
   - SSH/SSM into EC2 instance with tag "WebSocketApi"
   - Download app from S3 to `/var/www/websocketapi/`
   - Restart the systemd service: `sudo systemctl restart websocketapi`

The EC2 instance is already configured with the SystemD service and Nginx reverse proxy - it just needs the application DLL.

## Files to Edit

When modifying infrastructure:

- **bin/app.ts** - Environment configuration, instance type, VPC settings
- **lib/websocket-api-stack.ts** - All AWS resources (VPC, EC2, ALB, S3, etc.)
- **.github/workflows/cdk-deploy.yml** - CI/CD deployment automation (needs fixing)
- **cdk.json** - CDK context and feature flags
- **package.json** - Dependencies and npm scripts

## Notes for AI Assistants

- This is infrastructure code, not application code
- The .NET WebSocket application is deployed separately
- The `cdk-template/` directory appears to be a template copy - actual CDK code is at root
- Always test changes in dev environment first
- Use `cdk diff` before deploying to see what will change
- CDK creates immutable infrastructure - some changes require resource replacement
- The GitHub Actions workflow is currently broken and needs directory path fixes

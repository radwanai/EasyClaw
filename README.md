# EasyClaw — Multi-Tenant ClawdBot Provisioning

A 2-part system that provisions a dedicated runtime container per tenant on AWS ECS Fargate.

## Architecture

```
┌─────────────────────────────┐         ┌──────────────────────────┐
│     CONTROL PLANE           │         │   TENANT RUNTIME (N)     │
│     (Next.js, multi-tenant) │         │   (Node/TS, per-tenant)  │
│                             │         │                          │
│  - Signup/Login (NextAuth)  │  HTTP   │  GET  /health            │
│  - Tenant CRUD              │────────>│  POST /jobs/daily-brief  │
│  - Provision Runtime button │         │  POST /jobs/draft-reply  │
│  - Google OAuth connector   │         │                          │
│  - Health check / status    │         │  Reads secrets from      │
│  - Run Daily Brief          │         │  AWS Secrets Manager     │
│                             │         │  (Google OAuth tokens)   │
└──────────┬──────────────────┘         └──────────────────────────┘
           │
           │ AWS SDK
           ▼
┌────────────────────────────────────────┐
│  AWS                                   │
│  - ECS Fargate cluster (shared)        │
│  - ECR (tenant-runtime image)          │
│  - Secrets Manager (per-tenant)        │
│  - CloudWatch Logs                     │
│  - IAM roles                           │
└────────────────────────────────────────┘
```

## Repo Structure

```
/apps/control-plane   Next.js control plane (multi-tenant)
/apps/tenant-runtime  Node/TS Express service (single-tenant)
/infra                Terraform IaC for AWS resources
/scripts              Build & deploy scripts
```

## Quick Start (Local Dev with Mock AWS)

### Prerequisites
- Node.js 20+
- PostgreSQL (or use Docker)

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the control plane

```bash
cd apps/control-plane
cp .env.example .env
# Edit .env: set DATABASE_URL, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID/SECRET
# Keep USE_MOCK_PROVISIONER="true" for local dev

npx prisma generate
npx prisma db push
npm run dev
```

### 3. Test locally

1. Open http://localhost:3000
2. Sign in with Google
3. Create a tenant
4. Click "Provision ClawdBot" (uses mock provisioner)
5. Connect Google account
6. Run Daily Brief

### 4. Run tenant-runtime locally (optional)

```bash
cd apps/tenant-runtime
npm install
TENANT_ID=test-tenant \
CONTROL_PLANE_SHARED_SECRET=test-secret \
npm run dev
```

Then curl:
```bash
curl http://localhost:8080/health
curl -X POST http://localhost:8080/jobs/daily-brief \
  -H "x-clawdbot-secret: test-secret"
```

## Production Deployment (AWS)

### 1. Deploy infrastructure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform apply
```

Note the outputs — you'll need:
- `ecr_repository_url`
- `ecs_cluster_name`
- `task_execution_role_arn`
- `task_role_arn`
- `security_group_id`
- `subnet_ids`

### 2. Build and push runtime image

```bash
export AWS_REGION=us-east-1
export ECR_REPO_URI=<ecr_repository_url from terraform output>
./scripts/build-and-push-runtime-image.sh
```

### 3. Configure control plane

Set these in the control plane `.env` (or deployment env vars):

```
AWS_REGION=us-east-1
ECS_CLUSTER_NAME=clawdbot-cluster
ECR_REPO_URI=<ecr_repository_url>
ECS_TASK_EXECUTION_ROLE_ARN=<task_execution_role_arn>
ECS_TASK_ROLE_ARN=<task_role_arn>
VPC_SUBNET_IDS=<subnet-1,subnet-2>
VPC_SECURITY_GROUP_IDS=<sg-id>
CONTROL_PLANE_SHARED_SECRET=<generate a random secret>
USE_MOCK_PROVISIONER=false
```

### 4. Deploy control plane

Deploy the Next.js app to your preferred host (Vercel, ECS, EC2, etc).

### 5. Test end-to-end

1. Sign in and create a tenant
2. Click "Provision ClawdBot" — creates an ECS Fargate service
3. Wait for status to become "Healthy"
4. Connect Google account (tokens go to Secrets Manager)
5. Run Daily Brief — control plane calls tenant runtime

## Environment Variables

### Control Plane

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | NextAuth session secret |
| `NEXTAUTH_URL` | Yes | App base URL |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `AWS_REGION` | For AWS | AWS region |
| `AWS_ACCESS_KEY_ID` | For AWS | AWS credentials (or use IAM role) |
| `AWS_SECRET_ACCESS_KEY` | For AWS | AWS credentials |
| `ECS_CLUSTER_NAME` | For AWS | ECS cluster name |
| `ECR_REPO_URI` | For AWS | ECR repository URI |
| `ECS_TASK_EXECUTION_ROLE_ARN` | For AWS | Task execution IAM role |
| `ECS_TASK_ROLE_ARN` | For AWS | Task IAM role |
| `VPC_SUBNET_IDS` | For AWS | Comma-separated subnet IDs |
| `VPC_SECURITY_GROUP_IDS` | For AWS | Comma-separated SG IDs |
| `CONTROL_PLANE_SHARED_SECRET` | Yes | Shared secret for runtime auth |
| `USE_MOCK_PROVISIONER` | No | "true" for local dev without AWS |

### Tenant Runtime (set by ECS task definition)

| Variable | Description |
|----------|-------------|
| `TENANT_ID` | Tenant identifier |
| `AWS_REGION` | AWS region |
| `SECRETS_ID` | Secrets Manager secret ARN |
| `CONTROL_PLANE_SHARED_SECRET` | Shared secret for request auth |

## Security

- OAuth tokens are stored in AWS Secrets Manager, NOT in environment variables or database
- Tenant runtimes authenticate requests via `x-clawdbot-secret` header
- IAM task roles are scoped to each tenant's secret path
- Tokens are refreshed by the runtime and updated in Secrets Manager
- No API keys are exposed to end users

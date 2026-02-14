#!/usr/bin/env bash
set -euo pipefail

# Build and push the tenant-runtime Docker image to ECR.
#
# Required env vars:
#   AWS_REGION          - AWS region (e.g. us-east-1)
#   ECR_REPO_URI        - Full ECR repo URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/clawdbot-tenant-runtime)
#   IMAGE_TAG           - (optional) Image tag, defaults to "latest"

AWS_REGION="${AWS_REGION:?Set AWS_REGION}"
ECR_REPO_URI="${ECR_REPO_URI:?Set ECR_REPO_URI}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR/../apps/tenant-runtime"

echo "==> Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REPO_URI"

echo "==> Building tenant-runtime image..."
docker build -t "clawdbot-tenant-runtime:$IMAGE_TAG" "$RUNTIME_DIR"

echo "==> Tagging image..."
docker tag "clawdbot-tenant-runtime:$IMAGE_TAG" "$ECR_REPO_URI:$IMAGE_TAG"

echo "==> Pushing to ECR..."
docker push "$ECR_REPO_URI:$IMAGE_TAG"

echo "==> Done. Image pushed: $ECR_REPO_URI:$IMAGE_TAG"

#!/usr/bin/env bash
set -euo pipefail

# Deploy base infrastructure with Terraform.
#
# Required env vars:
#   AWS_REGION          - AWS region
#   AWS_ACCESS_KEY_ID   - AWS credentials
#   AWS_SECRET_ACCESS_KEY

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/../infra"

echo "==> Initializing Terraform..."
cd "$INFRA_DIR"
terraform init

echo "==> Planning..."
terraform plan -out=tfplan

echo ""
echo "Review the plan above. Apply? (Ctrl+C to cancel)"
read -r -p "Press Enter to apply..."

echo "==> Applying..."
terraform apply tfplan
rm -f tfplan

echo ""
echo "==> Infrastructure deployed. Outputs:"
terraform output

echo ""
echo "Next steps:"
echo "  1. Copy the ECR_REPO_URI, subnet IDs, and security group ID from outputs above"
echo "  2. Set them in your control-plane .env file"
echo "  3. Run scripts/build-and-push-runtime-image.sh to push the runtime image"
echo "  4. Start the control plane and provision a tenant"

# --- ECS Cluster (shared across all tenants) ---
resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.project_name}-cluster"
  }
}

# --- CloudWatch Log Group ---
resource "aws_cloudwatch_log_group" "tenant_runtime" {
  name              = "/ecs/${var.project_name}/tenant-runtime"
  retention_in_days = 30

  tags = {
    Name = "${var.project_name}-tenant-runtime-logs"
  }
}

# NOTE: Individual ECS Task Definitions and Services are created dynamically
# by the control plane via AWS SDK when a tenant clicks "Provision Runtime".
# The Terraform here only provisions the shared infrastructure.
#
# The control plane creates per-tenant:
#   - Task Definition: clawdbot-tenant-<TENANT_ID>
#   - Service:         clawdbot-tenant-<TENANT_ID>
#   - Secret:          clawdbot/tenant/<TENANT_ID>

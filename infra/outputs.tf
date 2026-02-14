output "ecr_repository_url" {
  description = "ECR repository URL for tenant runtime images"
  value       = aws_ecr_repository.tenant_runtime.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "task_execution_role_arn" {
  description = "IAM role ARN for ECS task execution"
  value       = aws_iam_role.ecs_task_execution.arn
}

output "task_role_arn" {
  description = "IAM role ARN for ECS task (runtime permissions)"
  value       = aws_iam_role.ecs_task.arn
}

output "security_group_id" {
  description = "Security group ID for tenant runtime tasks"
  value       = aws_security_group.tenant_runtime.id
}

output "subnet_ids" {
  description = "Subnet IDs for ECS tasks"
  value       = local.subnet_ids
}

output "log_group_name" {
  description = "CloudWatch log group for tenant runtimes"
  value       = aws_cloudwatch_log_group.tenant_runtime.name
}

output "vpc_id" {
  description = "VPC ID"
  value       = local.vpc_id
}

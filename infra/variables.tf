variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name prefix for resource naming"
  type        = string
  default     = "clawdbot"
}

variable "use_default_vpc" {
  description = "Whether to use the default VPC (true) or create a new one (false)"
  type        = bool
  default     = true
}

variable "control_plane_shared_secret" {
  description = "Shared secret for control-plane <-> runtime auth"
  type        = string
  sensitive   = true
}

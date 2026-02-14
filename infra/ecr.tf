resource "aws_ecr_repository" "tenant_runtime" {
  name                 = "${var.project_name}-tenant-runtime"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-tenant-runtime"
  }
}

resource "aws_ecr_lifecycle_policy" "tenant_runtime" {
  repository = aws_ecr_repository.tenant_runtime.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

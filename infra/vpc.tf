# --- Default VPC path (simplest) ---
data "aws_vpc" "default" {
  count   = var.use_default_vpc ? 1 : 0
  default = true
}

data "aws_subnets" "default" {
  count = var.use_default_vpc ? 1 : 0
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default[0].id]
  }
}

# --- Custom VPC path (if use_default_vpc = false) ---
resource "aws_vpc" "main" {
  count                = var.use_default_vpc ? 0 : 1
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  count  = var.use_default_vpc ? 0 : 1
  vpc_id = aws_vpc.main[0].id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

resource "aws_subnet" "public_a" {
  count                   = var.use_default_vpc ? 0 : 1
  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-a"
  }
}

resource "aws_subnet" "public_b" {
  count                   = var.use_default_vpc ? 0 : 1
  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-b"
  }
}

resource "aws_route_table" "public" {
  count  = var.use_default_vpc ? 0 : 1
  vpc_id = aws_vpc.main[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public_a" {
  count          = var.use_default_vpc ? 0 : 1
  subnet_id      = aws_subnet.public_a[0].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route_table_association" "public_b" {
  count          = var.use_default_vpc ? 0 : 1
  subnet_id      = aws_subnet.public_b[0].id
  route_table_id = aws_route_table.public[0].id
}

# --- Security Group ---
resource "aws_security_group" "tenant_runtime" {
  name_prefix = "${var.project_name}-runtime-"
  vpc_id      = var.use_default_vpc ? data.aws_vpc.default[0].id : aws_vpc.main[0].id

  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Tenant runtime HTTP"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound"
  }

  tags = {
    Name = "${var.project_name}-runtime-sg"
  }
}

# --- Locals for computed values ---
locals {
  vpc_id = var.use_default_vpc ? data.aws_vpc.default[0].id : aws_vpc.main[0].id
  subnet_ids = var.use_default_vpc ? data.aws_subnets.default[0].ids : [
    aws_subnet.public_a[0].id,
    aws_subnet.public_b[0].id,
  ]
}

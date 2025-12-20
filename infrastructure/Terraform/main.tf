# ================== TERRAFORM ==================
# infrastructure/terraform/main.tf

terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.20"
    }
  }

  backend "s3" {
    bucket         = "transport-optimizer-tfstate"
    key            = "terraform.tfstate"
    region         = "eu-west-1"
    encrypt        = true
    dynamodb_table = "terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "TransportOptimizer"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# VPC Configuration
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "transport-vpc-${var.environment}"
  }
}

# Public Subnets
resource "aws_subnet" "public" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = var.availability_zones[count.index]

  map_public_ip_on_launch = true

  tags = {
    Name                                           = "public-subnet-${count.index + 1}"
    "kubernetes.io/role/elb"                      = "1"
    "kubernetes.io/cluster/transport-${var.environment}" = "shared"
  }
}

# Private Subnets
resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 100)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name                                           = "private-subnet-${count.index + 1}"
    "kubernetes.io/role/internal-elb"             = "1"
    "kubernetes.io/cluster/transport-${var.environment}" = "shared"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "transport-igw-${var.environment}"
  }
}

# NAT Gateway
resource "aws_eip" "nat" {
  count  = length(var.availability_zones)
  domain = "vpc"

  tags = {
    Name = "nat-eip-${count.index + 1}"
  }
}

resource "aws_nat_gateway" "main" {
  count         = length(var.availability_zones)
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name = "nat-gateway-${count.index + 1}"
  }

  depends_on = [aws_internet_gateway.main]
}

# Route Tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "public-rt"
  }
}

resource "aws_route_table" "private" {
  count  = length(var.availability_zones)
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = {
    Name = "private-rt-${count.index + 1}"
  }
}

# Route Table Associations
resource "aws_route_table_association" "public" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Security Group for EKS
resource "aws_security_group" "eks_cluster" {
  name_prefix = "eks-cluster-sg-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS for Kubernetes API"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "eks-cluster-sg"
  }
}

# EKS Cluster
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 19.0"

  cluster_name    = "transport-${var.environment}"
  cluster_version = "1.28"

  vpc_id     = aws_vpc.main.id
  subnet_ids = concat(aws_subnet.private[*].id, aws_subnet.public[*].id)

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    general = {
      desired_size = 3
      min_size     = 2
      max_size     = 10

      instance_types = ["t3.medium"]
      capacity_type  = "ON_DEMAND"

      labels = {
        role = "general"
      }

      tags = {
        NodeGroup = "general"
      }
    }

    spot = {
      desired_size = 2
      min_size     = 1
      max_size     = 5

      instance_types = ["t3.medium", "t3a.medium"]
      capacity_type  = "SPOT"

      labels = {
        role = "spot"
      }

      tags = {
        NodeGroup = "spot"
      }
    }
  }

  tags = {
    Environment = var.environment
  }
}

# ElastiCache Redis Cluster
resource "aws_elasticache_subnet_group" "redis" {
  name       = "transport-redis-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "redis" {
  name_prefix = "redis-sg-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_cluster.id]
    description     = "Redis from EKS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "redis-sg"
  }
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "transport-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]

  tags = {
    Name = "transport-redis"
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "app_logs" {
  name              = "/aws/transport-optimizer/${var.environment}"
  retention_in_days = 30

  tags = {
    Application = "TransportOptimizer"
  }
}

# S3 Bucket for logs and backups
resource "aws_s3_bucket" "backups" {
  bucket = "transport-optimizer-backups-${var.environment}"

  tags = {
    Name = "backups"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Outputs
output "cluster_endpoint" {
  description = "Endpoint for EKS control plane"
  value       = module.eks.cluster_endpoint
}

output "cluster_name" {
  description = "Kubernetes Cluster Name"
  value       = module.eks.cluster_name
}

output "redis_endpoint" {
  description = "Redis cluster endpoint"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}

---
# infrastructure/terraform/variables.tf

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
}

variable "cluster_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.28"
}

---
# ================== ANSIBLE ==================
# infrastructure/ansible/playbooks/deploy.yml

---
- name: Deploy Transport Optimizer Application
  hosts: kubernetes_master
  become: yes
  vars:
    app_name: transport-optimizer
    namespace: transport-optimizer
    docker_registry: "{{ docker_registry_url }}"
    app_version: "{{ lookup('env', 'APP_VERSION') | default('latest', true) }}"

  tasks:
    - name: Ensure kubectl is installed
      apt:
        name: kubectl
        state: present
      when: ansible_os_family == "Debian"

    - name: Create namespace if not exists
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: v1
          kind: Namespace
          metadata:
            name: "{{ namespace }}"

    - name: Deploy Redis
      kubernetes.core.k8s:
        state: present
        src: "{{ playbook_dir }}/../kubernetes/redis-deployment.yaml"
        namespace: "{{ namespace }}"

    - name: Wait for Redis to be ready
      kubernetes.core.k8s_info:
        kind: Pod
        namespace: "{{ namespace }}"
        label_selectors:
          - app=redis
        wait: yes
        wait_condition:
          type: Ready
          status: "True"
        wait_timeout: 300

    - name: Deploy Backend application
      kubernetes.core.k8s:
        state: present
        src: "{{ playbook_dir }}/../kubernetes/backend-deployment.yaml"
        namespace: "{{ namespace }}"

    - name: Deploy Frontend application
      kubernetes.core.k8s:
        state: present
        src: "{{ playbook_dir }}/../kubernetes/frontend-deployment.yaml"
        namespace: "{{ namespace }}"

    - name: Apply Ingress configuration
      kubernetes.core.k8s:
        state: present
        src: "{{ playbook_dir }}/../kubernetes/ingress.yaml"
        namespace: "{{ namespace }}"

    - name: Verify deployment status
      kubernetes.core.k8s_info:
        kind: Deployment
        namespace: "{{ namespace }}"
        name: "{{ item }}"
      register: deployment_status
      with_items:
        - redis
        - backend
        - frontend
      until: deployment_status.resources[0].status.readyReplicas == deployment_status.resources[0].status.replicas
      retries: 10
      delay: 30

    - name: Get service endpoints
      kubernetes.core.k8s_info:
        kind: Service
        namespace: "{{ namespace }}"
      register: services

    - name: Display service information
      debug:
        msg: "Service {{ item.metadata.name }} is available at {{ item.spec.clusterIP }}"
      loop: "{{ services.resources }}"

---
# infrastructure/ansible/inventory/hosts.ini

[kubernetes_master]
k8s-master-1 ansible_host=10.0.1.10 ansible_user=ubuntu

[kubernetes_workers]
k8s-worker-1 ansible_host=10.0.1.11 ansible_user=ubuntu
k8s-worker-2 ansible_host=10.0.1.12 ansible_user=ubuntu
k8s-worker-3 ansible_host=10.0.1.13 ansible_user=ubuntu

[all:vars]
ansible_python_interpreter=/usr/bin/python3
docker_registry_url=registry.example.com
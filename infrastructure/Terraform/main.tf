terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.0"
    }
  }
}

provider "kubernetes" {
  config_path = "~/.kube/config"
}

# ==================== VARIABLES ====================
variable "tomtom_api_key" {
  description = "TomTom API Key from Jenkins"
  type        = string
  default     = "YOUR_TOMTOM_API_KEY_HERE"
  sensitive   = true
}

variable "opencage_api_key" {
  description = "OpenCage API Key from Jenkins"
  type        = string
  default     = "YOUR_OPENCAGE_API_KEY_HERE"
  sensitive   = true
}

variable "ors_api_key" {
  description = "OpenRouteService API Key from Jenkins"
  type        = string
  default     = "YOUR_ORS_API_KEY_HERE"
  sensitive   = true
}

# ==================== SECRETS ====================
resource "kubernetes_secret_v1" "redis_credentials" {
  metadata {
    name      = "redis-credentials"
    namespace = "default"
  }

  data = {
    password = "monsecret"
  }

  type = "Opaque"
}

# ✅ SECRET CORRIGÉ: Toutes les clés API
resource "kubernetes_secret_v1" "api_keys" {
  metadata {
    name      = "api-keys"
    namespace = "default"
  }

  data = {
    tomtom_api_key   = var.tomtom_api_key
    opencage_api_key = var.opencage_api_key
    ors_api_key      = var.ors_api_key
  }

  type = "Opaque"
}

# ==================== REDIS DEPLOYMENT ====================
resource "kubernetes_deployment_v1" "redis" {
  metadata {
    name = "redis"
    labels = {
      app = "redis"
    }
    namespace = "default"
  }

  spec {
    replicas = 1
    
    selector {
      match_labels = {
        app = "redis"
      }
    }

    template {
      metadata {
        labels = {
          app = "redis"
        }
      }

      spec {
        container {
          name              = "redis"
          image             = "redis:7-alpine"
          image_pull_policy = "IfNotPresent"

          port {
            container_port = 6379
            name           = "redis"
            protocol       = "TCP"
          }

          command = ["redis-server"]
          args    = ["--requirepass", "monsecret"]

          # Health checks
          liveness_probe {
            exec {
              command = ["redis-cli", "ping"]
            }
            initial_delay_seconds = 30
            period_seconds        = 10
            timeout_seconds       = 5
            failure_threshold     = 3
          }

          readiness_probe {
            exec {
              command = ["redis-cli", "ping"]
            }
            initial_delay_seconds = 5
            period_seconds        = 5
            timeout_seconds       = 3
            failure_threshold     = 3
          }

          resources {
            requests = {
              memory = "128Mi"
              cpu    = "100m"
            }
            limits = {
              memory = "256Mi"
              cpu    = "200m"
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "redis" {
  metadata {
    name = "redis-service"
    labels = {
      app = "redis"
    }
    namespace = "default"
  }

  spec {
    selector = {
      app = "redis"
    }

    port {
      port        = 6379
      target_port = 6379
      protocol    = "TCP"
      name        = "redis"
    }

    type = "ClusterIP"
  }
}

# ==================== BACKEND DEPLOYMENT ====================
resource "kubernetes_deployment_v1" "backend" {
  metadata {
    name = "backend"
    labels = {
      app = "backend"
    }
    namespace = "default"
  }

  spec {
    replicas = 3

    selector {
      match_labels = {
        app = "backend"
      }
    }

    template {
      metadata {
        labels = {
          app = "backend"
        }
      }

      spec {
        container {
          name              = "backend"
          image             = "transport-backend:latest"
          image_pull_policy = "IfNotPresent"

          port {
            container_port = 3000
            name           = "http"
            protocol       = "TCP"
          }

          # ✅ TOUTES LES VARIABLES D'ENVIRONNEMENT
          env {
            name  = "REDIS_URL"
            value = "redis://:monsecret@redis-service:6379"
          }

          env {
            name = "TOMTOM_API_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.api_keys.metadata[0].name
                key  = "tomtom_api_key"
              }
            }
          }

          env {
            name = "OPENCAGE_API_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.api_keys.metadata[0].name
                key  = "opencage_api_key"
              }
            }
          }

          env {
            name = "ORS_API_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.api_keys.metadata[0].name
                key  = "ors_api_key"
              }
            }
          }

          env {
            name  = "PORT"
            value = "3000"
          }

          env {
            name  = "NODE_ENV"
            value = "production"
          }

          env {
            name  = "CACHE_TTL"
            value = "3600"
          }

          env {
            name  = "MAX_WALKING_DISTANCE"
            value = "800"
          }

          env {
            name  = "TRANSFER_PENALTY"
            value = "180"
          }

          env {
            name  = "WALKING_SPEED"
            value = "1.4"
          }

          env {
            name  = "REQUEST_TIMEOUT"
            value = "20000"
          }

          env {
            name  = "ALLOWED_ORIGINS"
            value = "http://localhost:3001,http://localhost,http://localhost:8080"
          }

          # Health checks
          liveness_probe {
            http_get {
              path   = "/health"
              port   = 3000
              scheme = "HTTP"
            }
            initial_delay_seconds = 30
            period_seconds        = 10
            timeout_seconds       = 5
            failure_threshold     = 3
          }

          readiness_probe {
            http_get {
              path   = "/health"
              port   = 3000
              scheme = "HTTP"
            }
            initial_delay_seconds = 10
            period_seconds        = 5
            timeout_seconds       = 3
            failure_threshold     = 3
          }

          resources {
            requests = {
              memory = "256Mi"
              cpu    = "200m"
            }
            limits = {
              memory = "512Mi"
              cpu    = "500m"
            }
          }
        }
      }
    }
  }

  # Assure que Redis est déployé avant le backend
  depends_on = [
    kubernetes_deployment_v1.redis,
    kubernetes_service_v1.redis
  ]
}

resource "kubernetes_service_v1" "backend" {
  metadata {
    name = "backend-service"
    labels = {
      app = "backend"
    }
    namespace = "default"
  }

  spec {
    selector = {
      app = "backend"
    }

    port {
      port        = 3000
      target_port = 3000
      node_port   = 30002
      protocol    = "TCP"
      name        = "http"
    }

    type = "NodePort"
  }
}

# ==================== FRONTEND DEPLOYMENT ====================
resource "kubernetes_deployment_v1" "frontend" {
  metadata {
    name = "frontend"
    labels = {
      app = "frontend"
    }
    namespace = "default"
  }

  spec {
    replicas = 2

    selector {
      match_labels = {
        app = "frontend"
      }
    }

    template {
      metadata {
        labels = {
          app = "frontend"
        }
      }

      spec {
        container {
          name              = "frontend"
          image             = "transport-frontend:latest"
          image_pull_policy = "IfNotPresent"

          port {
            container_port = 80
            name           = "http"
            protocol       = "TCP"
          }

          env {
            name  = "API_URL"
            value = "http://backend-service:3000"
          }

          # Health checks
          liveness_probe {
            http_get {
              path   = "/"
              port   = 80
              scheme = "HTTP"
            }
            initial_delay_seconds = 10
            period_seconds        = 10
            timeout_seconds       = 5
            failure_threshold     = 3
          }

          readiness_probe {
            http_get {
              path   = "/"
              port   = 80
              scheme = "HTTP"
            }
            initial_delay_seconds = 5
            period_seconds        = 5
            timeout_seconds       = 3
            failure_threshold     = 3
          }

          resources {
            requests = {
              memory = "128Mi"
              cpu    = "100m"
            }
            limits = {
              memory = "256Mi"
              cpu    = "200m"
            }
          }
        }
      }
    }
  }

  # Assure que le backend est déployé avant le frontend
  depends_on = [
    kubernetes_deployment_v1.backend,
    kubernetes_service_v1.backend
  ]
}

resource "kubernetes_service_v1" "frontend" {
  metadata {
    name = "frontend-service"
    labels = {
      app = "frontend"
    }
    namespace = "default"
  }

  spec {
    selector = {
      app = "frontend"
    }

    port {
      port        = 80
      target_port = 80
      node_port   = 30001
      protocol    = "TCP"
      name        = "http"
    }

    type = "NodePort"
  }
}

# ==================== OUTPUTS ====================
output "backend_nodeport" {
  value       = "30002"
  description = "Port NodePort du backend"
}

output "frontend_nodeport" {
  value       = "30001"
  description = "Port NodePort du frontend"
}

output "redis_service" {
  value       = "redis-service:6379"
  description = "Service Redis interne"
}

output "backend_url" {
  value       = "http://localhost:30002"
  description = "URL d'accès au backend (après port-forward)"
}

output "frontend_url" {
  value       = "http://localhost:30001"
  description = "URL d'accès au frontend (après port-forward)"
}
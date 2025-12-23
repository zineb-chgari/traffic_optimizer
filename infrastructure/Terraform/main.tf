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

# ==================== SECRETS ====================
resource "kubernetes_secret_v1" "redis_credentials" {
  metadata {
    name = "redis-credentials"
  }

  data = {
    password = "monsecret"
  }

  type = "Opaque"
}

resource "kubernetes_secret_v1" "api_keys" {
  metadata {
    name = "api-keys"
  }

  data = {
    ors_api_key    = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjIwNjAxYzVlZmFlNjQ1OGZiOTY3ODUxNDg3NTY2MjBlIiwiaCI6Im11cm11cjY0In0="
    tomtom_api_key = "YOUR_TOMTOM_API_KEY"  # ⚠️ Remplacez par votre vraie clé
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
          }

          readiness_probe {
            exec {
              command = ["redis-cli", "ping"]
            }
            initial_delay_seconds = 5
            period_seconds        = 5
            timeout_seconds       = 3
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
  }

  spec {
    selector = {
      app = "redis"
    }

    port {
      port        = 6379
      target_port = 6379
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
          }

          # ✅ CORRECTION: URL Redis avec authentification
          env {
            name  = "REDIS_URL"
            value = "redis://:monsecret@redis-service:6379"
          }

          # Variables d'environnement pour les API keys
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
            name = "TOMTOM_API_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.api_keys.metadata[0].name
                key  = "tomtom_api_key"
              }
            }
          }

          env {
            name  = "PORT"
            value = "3000"
          }

          # Health checks
          liveness_probe {
            http_get {
              path = "/health"
              port = 3000
            }
            initial_delay_seconds = 30
            period_seconds        = 10
            timeout_seconds       = 5
            failure_threshold     = 3
          }

          readiness_probe {
            http_get {
              path = "/health"
              port = 3000
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
  }

  spec {
    selector = {
      app = "backend"
    }

    port {
      port        = 3000
      target_port = 3000
      node_port   = 30002
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
          }

          # ⚠️ À adapter selon votre configuration
          env {
            name  = "API_URL"
            value = "http://backend-service:3000"
          }

          # Health checks
          liveness_probe {
            http_get {
              path = "/"
              port = 80
            }
            initial_delay_seconds = 10
            period_seconds        = 10
            timeout_seconds       = 5
          }

          readiness_probe {
            http_get {
              path = "/"
              port = 80
            }
            initial_delay_seconds = 5
            period_seconds        = 5
            timeout_seconds       = 3
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
  }

  spec {
    selector = {
      app = "frontend"
    }

    port {
      port        = 80
      target_port = 80
      node_port   = 30001
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
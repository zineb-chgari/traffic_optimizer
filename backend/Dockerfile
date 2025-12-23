# ==========================================
# Backend Dockerfile - Multi-stage Production
# ==========================================

# Stage 1: Dependencies
FROM node:20-alpine AS dependencies

WORKDIR /app

# Copier uniquement les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances (dev + prod)
RUN npm install && npm cache clean --force

# Stage 2: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copier les dépendances installées
COPY --from=dependencies /app/node_modules ./node_modules

# Copier le code source
COPY . .

# Installer uniquement les dépendances de production (optionnel)
RUN npm install --production && npm cache clean --force

# Stage 3: Production
FROM node:20-alpine

# Créer un utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/logs && \
    chown -R nodejs:nodejs /app

WORKDIR /app

# Copier les dépendances et le code depuis le builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/ ./ 

# Passer à l'utilisateur non-root
USER nodejs

# Exposer le port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    PORT=3000

# Démarrer l'application
CMD ["node", "src/index.js"]

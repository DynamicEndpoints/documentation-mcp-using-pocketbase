# Dockerfile for Smithery Container Deployment
FROM node:18-alpine

# Add curl for health checks
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production --silent

# Copy application files
COPY src/ ./src/
COPY README.md ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcp -u 1001 -G nodejs

# Set proper permissions
RUN chown -R mcp:nodejs /app
USER mcp

# Set environment for HTTP mode (required for Smithery)
ENV TRANSPORT_MODE=http
ENV NODE_ENV=production

# Smithery will set the PORT environment variable
EXPOSE 3000

# Health check using curl
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Start the server
CMD ["npm", "start"]

FROM node:18-alpine

WORKDIR /app

# Copy package files from backend subdirectory relative to repository root build context
COPY backend/package*.json ./

RUN npm ci --only=production

# Copy the rest of backend files
COPY backend/ .

ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "server.js"]

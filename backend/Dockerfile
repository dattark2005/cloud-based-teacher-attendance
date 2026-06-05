FROM node:18-alpine

WORKDIR /app

# Copy package files from backend subdirectory
COPY backend/package*.json ./

# Use npm install --omit=dev which is more resilient to lockfile sync issues than npm ci
RUN npm install --omit=dev

# Copy the rest of backend files
COPY backend/ .

ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "server.js"]

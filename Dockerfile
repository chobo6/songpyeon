# --- Stage 1: client build ---
FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY client/ client/
RUN npm run build --workspace client

# --- Stage 2: server runtime ---
FROM node:22-slim AS server
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY server/ server/
COPY --from=client-build /app/client/dist ./server/public

WORKDIR /app/server
ENV PORT=2567
EXPOSE 2567
CMD ["npm", "start"]

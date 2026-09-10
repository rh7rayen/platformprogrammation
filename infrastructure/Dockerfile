FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.18.0-bookworm-slim AS api
ENV NODE_ENV=production PROJECT_ROOT=/app HOST=0.0.0.0 PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@uniexam/backend"]

FROM node:24.18.0-bookworm-slim AS web
ENV NODE_ENV=production PROJECT_ROOT=/app PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@uniexam/frontend"]

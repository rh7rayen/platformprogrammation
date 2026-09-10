FROM node:24-alpine3.22
RUN apk add --no-cache bash sqlite \
 && npm install --global --ignore-scripts --no-audit --no-fund typescript@5.9.3 \
 && npm install --prefix /opt/types --ignore-scripts --no-audit --no-fund @types/node@24.10.1 \
 && npm cache clean --force

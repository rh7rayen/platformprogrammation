FROM node:24-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a
WORKDIR /opt/uniexam
# Dependencies are installed while preparing the trusted image, never per exam.
COPY package.json package-lock.json ./
RUN node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major!==24||minor<15) throw Error('Angular requires Node 24.15 or newer');" \
 && npm ci --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force \
 && node --input-type=module -e "import {transformSync} from 'esbuild'; transformSync('const answer: number = 42', {loader:'ts'});"
COPY build.mjs project.mjs summary.mjs ./
RUN chmod a+r build.mjs project.mjs summary.mjs
USER 65534:65534
WORKDIR /tmp

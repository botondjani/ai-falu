FROM node:22
WORKDIR /app
COPY . .
RUN npm ci && npm -w @falu/viewer run build
ENV NODE_ENV=production \
    SIM_STATIC_DIR=packages/viewer/dist \
    SIM_AUTO_RESUME=1
EXPOSE 8787
CMD ["npx", "tsx", "packages/sim/src/cli.ts"]

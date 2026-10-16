# Servidor del agente Radar. Node 24: trae node:sqlite sin compilar módulos nativos. Se ejecuta con tsx (sin build).
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app

# Dependencias primero (aprovecha la caché de Docker). tsx es devDependency pero es lo que ejecuta el servidor.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json profile.json ./
COPY src ./src

# Maritime guarda solo lo que está en /data (persiste entre reinicios, redeploys y sleep/wake): ahí va SQLite.
ENV DB_PATH=/data/radar.db
VOLUME /data

# Maritime inyecta PORT; si no, 3000. El servidor escucha en 0.0.0.0.
EXPOSE 3000
CMD ["pnpm", "start"]

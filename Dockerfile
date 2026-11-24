FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Europe/Lisbon

RUN apk add --no-cache tzdata

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

# Corre como root de propósito: o ZimaOS cria /DATA/AppData/... como root e o bind mount
# tem de ser gravável sem passos manuais.
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]

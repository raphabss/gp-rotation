FROM node:20-alpine

WORKDIR /app

# su-exec: usado pelo entrypoint para largar o privilégio de root e rodar
# o app como usuário 'node' (padrão das imagens oficiais Postgres/Grafana).
RUN apk add --no-cache su-exec tzdata
ENV TZ=America/Sao_Paulo

# Dependências primeiro (cache de camada)
COPY package.json ./
RUN npm install --omit=dev

# Código
COPY src/ ./src/

# Entrypoint que alinha o dono do volume e faz step-down de privilégio
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# DATA_DIR explícito para não depender de __dirname
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 3000

# NÃO define USER node: o container inicia como root para que o entrypoint
# possa ajustar o dono do volume; o app é iniciado SEM privilégio via su-exec.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]

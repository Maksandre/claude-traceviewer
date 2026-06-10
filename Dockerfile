# Pinned by digest so cached builds skip the registry metadata round-trip,
# which flakes on Docker Desktop (EOF / DNS failures on registry-1.docker.io).
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3099

CMD ["npm", "start"]

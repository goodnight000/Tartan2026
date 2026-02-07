FROM node:20-alpine

WORKDIR /app

COPY carebase_server/package*.json ./
RUN npm ci

COPY carebase_server ./

ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100

RUN npm run build

EXPOSE 3100

CMD ["npm", "run", "start"]

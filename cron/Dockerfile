FROM denoland/deno:alpine

RUN apk add --no-cache git

WORKDIR /app

RUN git clone https://github.com/richardhristov/scripts .

COPY cron.conf.json /app/cron.conf.json

CMD ["deno", "run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", "cron.ts", "--config", "cron.conf.json"]
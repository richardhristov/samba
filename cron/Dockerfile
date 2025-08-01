FROM denoland/deno:alpine

RUN apk add --no-cache git

WORKDIR /app

COPY cron.conf.json /app/cron.conf.json

RUN git clone https://github.com/richardhristov/scripts

CMD ["deno", "run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", "cron.ts", "--config", "cron.conf.json"]
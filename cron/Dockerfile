FROM denoland/deno:debian

RUN apt-get update && apt-get install -y git python3 python3-pip && rm -rf /var/lib/apt/lists/*

RUN pip3 install gallery-dl

WORKDIR /app

RUN git clone https://github.com/richardhristov/scripts .

COPY cron.conf.json /app/cron.conf.json

# Pre-download and cache Deno dependencies
RUN deno cache --lock-write=deno.lock cron.ts
RUN deno cache --lock-write=deno.lock gallery-update.ts
RUN deno cache --lock-write=deno.lock grid.ts

CMD ["deno", "run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", "--allow-net", "--lock=deno.lock", "cron.ts", "--config", "cron.conf.json"]
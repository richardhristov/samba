#!/bin/sh

mkdir -p data/share
mkdir -p data/share/torrent-config
mkdir -p data/share/jellyfin-config
mkdir -p data/share/jellyfin-cache
mkdir -p data/share/Downloads
mkdir -p data/timemachinebackup

chown -R 3000:3000 data/share
chown -R 3000:3000 data/timemachinebackup

#!/bin/sh

mkdir -p data/share
mkdir -p data/timemachinebackup
mkdir -p data/share/Downloads
mkdir -p data/share/Syncthing
mkdir -p data/torrent-config
mkdir -p data/syncthing-config

chown -R 3000:3000 data

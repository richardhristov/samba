#!/bin/sh

mkdir -p data/share
mkdir -p data/timemachinebackup

chown -R 3000:3000 data/share
chown -R 3000:3000 data/timemachinebackup

chcon -R -t svirt_sandbox_file_t data/share
chcon -R -t svirt_sandbox_file_t data/timemachinebackup

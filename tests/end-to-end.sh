#!/bin/bash

set -v
npm run build
REDIS_DIR=$(./lib/cli.js | tail -1)/src
$REDIS_DIR/redis-server &
SERVER_PID=$!
sleep 1
$REDIS_DIR/redis-cli ECHO test
kill $SERVER_PID

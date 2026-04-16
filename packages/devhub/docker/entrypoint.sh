#!/bin/bash
set -e

cd /app

# Fix git worktree reference for Docker
# /app/.git is bind-mounted from .gitfile-docker (points to /tmp/git-worktree)
# We just need to populate /tmp/git-worktree with the correct data
if [ -d /app/.worktree-git ] && [ -d /main-git ]; then
  mkdir -p /tmp/git-worktree
  cp -a /app/.worktree-git/* /tmp/git-worktree/ 2>/dev/null || true
  echo "/main-git" > /tmp/git-worktree/commondir
  echo "/app" > /tmp/git-worktree/gitdir
  # CRLF fix for Windows-mounted files
  git config --global core.autocrlf true
fi

# Install dependencies (Linux-native binaries via Docker volume)
echo "=== Installing dependencies (bun) ==="
bun install 2>&1 | tail -5

# Build diluu-shared (required by other packages)
echo "=== Building diluu-shared ==="
cd /app/packages/diluu-shared
npx tsc 2>&1 | tail -3 || true
cd /app

# Give dev user write access (Claude Code runs as dev)
chown -R dev:dev /app 2>/dev/null || true

# Start backend with watch mode (auto-restart on file changes)
echo "=== Starting backend with tsx watch ==="
cd /app/packages/lessons-links
exec npx tsx watch src/bootstrap.ts

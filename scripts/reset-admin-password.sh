#!/usr/bin/env bash
# Reset the password for a MyCalPal user.
# Run from the MyCalPal project root (where docker-compose.yml lives).
#
# Usage:
#   ./scripts/reset-admin-password.sh              # prompts for password
#   ./scripts/reset-admin-password.sh 'new-pass'   # password on CLI

set -euo pipefail

EMAIL="${EMAIL:-bryantvan@gmail.com}"
DB_USER="${POSTGRES_USER:-mycalpal}"
DB_NAME="${POSTGRES_DB:-mycalpal}"

if [[ $# -ge 1 ]]; then
  NEW_PASSWORD="$1"
else
  read -r -s -p "New password for $EMAIL: " NEW_PASSWORD
  echo
  read -r -s -p "Confirm: " CONFIRM
  echo
  if [[ "$NEW_PASSWORD" != "$CONFIRM" ]]; then
    echo "Passwords do not match." >&2
    exit 1
  fi
fi

if [[ -z "$NEW_PASSWORD" ]]; then
  echo "Password cannot be empty." >&2
  exit 1
fi

echo "Generating bcrypt hash..."
HASH=$(docker compose exec -T api python -c "
import sys
from app.auth import hash_password
print(hash_password(sys.argv[1]))
" "$NEW_PASSWORD")

if [[ -z "$HASH" ]]; then
  echo "Failed to generate hash." >&2
  exit 1
fi

echo "Updating $EMAIL in database..."
ROWS=$(docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "UPDATE users SET password_hash='$HASH' WHERE email='$EMAIL' RETURNING id;")

if [[ -z "$ROWS" ]]; then
  echo "No user found with email $EMAIL." >&2
  exit 1
fi

echo "Password reset for $EMAIL (user id: $ROWS)."

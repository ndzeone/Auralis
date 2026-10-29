#!/usr/bin/env sh
set -eu
# Run from the repository root; configure an encrypted external backup destination.
# Secrets stay in Compose's environment and are never written into the backup command.
backup_dir=${1:-.local/backups}
mkdir -p "$backup_dir"
umask 077
backup_name="auralis-$(date -u +%Y%m%dT%H%M%SZ).dump"
backup_tmp="$backup_dir/$backup_name.partial"
trap 'rm -f "$backup_tmp"' EXIT HUP INT TERM
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_tmp"
test -s "$backup_tmp"
mv "$backup_tmp" "$backup_dir/$backup_name"
printf '%s\n' "Backup created: $backup_dir/$backup_name"

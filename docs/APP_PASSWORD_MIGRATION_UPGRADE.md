# Staged App Password migration upgrade

This procedure is only for installations that previously ran the fork's legacy App Password migrations. Fresh installations and
installations upgraded directly from upstream use the normal migration command.

The legacy upgrade has four ordered database phases. Do not skip or reorder them:

1. Prepare the legacy ledger with the final BookOrbit image.
2. Apply upstream migrations 0076 through 0140 with the immutable upstream-only image.
3. Finalize the compatibility baseline with the final BookOrbit image.
4. Apply migrations 0141 and 0142 with the final BookOrbit image.

The middle image is deliberately different from the final image. The final image's normal migrator refuses an unfinalized legacy
database, while the upstream-only image contains the exact upstream migration sequence needed between prepare and finalize.

## Set immutable image references

Run the commands from the directory containing `docker-compose.yml` and `.env`. Replace all three example image references with the
references published for the deployment.

```sh
export FINAL_IMAGE_REF='registry.example/bookorbit:sha-<final-commit>'
export UPSTREAM_ONLY_IMAGE_REF='registry.example/bookorbit-upstream-only:sha-022f9d10'
export PREVIOUS_IMAGE_REF='registry.example/bookorbit:sha-<previous-commit>'
export BACKUP_FILE="$PWD/bookorbit-before-app-password-sync.dump"

docker pull "$FINAL_IMAGE_REF"
docker pull "$UPSTREAM_ONLY_IMAGE_REF"
docker pull "$PREVIOUS_IMAGE_REF"

upstream_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$UPSTREAM_ONLY_IMAGE_REF")"
upstream_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$UPSTREAM_ONLY_IMAGE_REF")"
case "$upstream_version:$upstream_revision" in
  sha-022f9d10*:* | *:sha-022f9d10* | *:022f9d10*) ;;
  *) echo "Unexpected upstream-only image identity: version=$upstream_version revision=$upstream_revision" >&2; exit 1 ;;
esac

export FINAL_IMAGE="$(docker image inspect --format '{{index .RepoDigests 0}}' "$FINAL_IMAGE_REF")"
export UPSTREAM_ONLY_IMAGE="$(docker image inspect --format '{{index .RepoDigests 0}}' "$UPSTREAM_ONLY_IMAGE_REF")"
export PREVIOUS_IMAGE="$(docker image inspect --format '{{index .RepoDigests 0}}' "$PREVIOUS_IMAGE_REF")"

test -n "$FINAL_IMAGE"
test -n "$UPSTREAM_ONLY_IMAGE"
test -n "$PREVIOUS_IMAGE"
```

The resolved `name@sha256:...` values are immutable for this run. Save those three values with the backup. Do not substitute a
rolling tag such as `latest` for any phase.

Define a wrapper that builds `DATABASE_URL` inside the temporary container from the existing Compose `POSTGRES_*` environment. This
keeps the database password out of the command line and shell history while correctly percent-encoding reserved characters.
For the compatibility phases, the wrapper executes the compiled runtime command
`node dist/scripts/app-password-migration-compatibility-cli.js prepare|finalize` inside the selected image.

```sh
run_bookorbit_node() {
  image_ref="$1"
  shift
  APP_IMAGE="$image_ref" docker compose run --rm --no-deps \
    --entrypoint sh app -c '
      encoded_user="$(node -e '\''process.stdout.write(encodeURIComponent(process.argv[1]))'\'' "$POSTGRES_USER")" || exit
      encoded_password="$(node -e '\''process.stdout.write(encodeURIComponent(process.argv[1]))'\'' "$POSTGRES_PASSWORD")" || exit
      encoded_db="$(node -e '\''process.stdout.write(encodeURIComponent(process.argv[1]))'\'' "$POSTGRES_DB")" || exit
      export DATABASE_URL="postgres://${encoded_user}:${encoded_password}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${encoded_db}"
      exec node "$@"
    ' sh "$@"
}
```

## Stop the app and back up PostgreSQL

Keep PostgreSQL running, but stop the app before taking the backup so no writes occur during the staged upgrade.

```sh
umask 077
docker compose stop app
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$BACKUP_FILE"
docker compose exec -T postgres pg_restore --list < "$BACKUP_FILE" >/dev/null
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
sha256sum --check "$BACKUP_FILE.sha256"
```

Keep the app stopped until all four database phases have succeeded.

## Run the four phases

### 1. Prepare with the final image

```sh
run_bookorbit_node "$FINAL_IMAGE" dist/scripts/app-password-migration-compatibility-cli.js prepare
```

### 2. Apply the upstream-only middle step

This exact immutable image step is required. It must run after `prepare` and before `finalize`.

```sh
run_bookorbit_node "$UPSTREAM_ONLY_IMAGE" dist/scripts/migrate.js
```

### 3. Finalize with the final image

```sh
run_bookorbit_node "$FINAL_IMAGE" dist/scripts/app-password-migration-compatibility-cli.js finalize
```

Finalization revokes only active refresh tokens linked to legacy App Passwords. Existing revoked timestamps, App Password records,
and reading attribution are preserved. Existing sessions, especially App Password sessions, may need to sign in again after this
schema transition.

### 4. Apply the final migrations

```sh
run_bookorbit_node "$FINAL_IMAGE" dist/scripts/migrate.js
```

Production images contain compiled JavaScript and do not contain the `tsx` development runner. Use the explicit `node dist/...`
commands above inside images. Do not use the source-checkout `pnpm db:app-password-compat` command for this procedure.

## Start and verify

Set `APP_IMAGE` in `.env` to the exact value printed in `FINAL_IMAGE`, then confirm the rendered Compose configuration and start the
app:

```sh
docker compose config | grep 'image:'
docker compose up -d app
docker compose ps
docker compose logs --tail=200 app
```

Verify that the health check passes, password sign-in works, an App Password can sign in, and new reading progress and sessions show
the expected app name. Keep the backup until those checks and the next scheduled backup have completed.

## Failure and rollback

Every compatibility phase is transactional and can be retried after correcting a reported validation error. Do not continue to the
next phase after a failure.

After the upstream-only migration step has started, changing only the app image is not a safe rollback. Stop the app, restore the
pre-upgrade dump into a clean database, set `APP_IMAGE` back to `PREVIOUS_IMAGE`, and then start the previous version. Preserve the
failed database separately until the cause has been understood.

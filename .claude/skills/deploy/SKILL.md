---
name: deploy
description: Deploy the genealogy service to the remote machine over SSH. Use this skill when asked to deploy, release, roll out or ship genealogy to the server.
---

Use this skill for the regular genealogy rollout to the remote machine.
Do not skip any steps. If you cannot do something — stop and say so, do not improvise.

## How the rollout works

The image is built **on this machine** (or in CI) and shipped to the server as a
gzipped tarball; the server only runs `docker load` + `docker compose up`. The
server compiles nothing: there is no npm, no node_modules and no `src/` on it.

`docker-compose-prod.yml` has no `build:` section — the `app` service just runs the
prebuilt `genealogy_app:3.0.0` image. There is no database.

**The tree lives on the server's disk**, in `/root/genealogy/data` (a card per
person, `photos/` beside them), bind-mounted into the container as `/app/data`. A
deploy, a restart and a reboot keep it. Never delete that folder to "reset"
anything: it is the family tree.

> Still take the archive **before** deploying (step 3): it is the copy that survives
> losing the server. If the tree is missing afterwards, put it back (step 9).

Servers deployed before this change kept the tree in memory. The first deploy of
the disk version starts with an empty `data/`: step 3 is then the only copy, and
step 9 is mandatory.

## Required inputs

They live in `.env` at the repository root, which git ignores and the image never
sees; the `Makefile` reads it. Never write them into any other file and never
commit them. If `.env` is missing, copy `.env.example` and ask the user for the
values. Stop immediately if any value is missing or empty.

```text
PROD_HOST=            # IP address of the server
SSH_USER=             # usually root
SSHPASS=              # only for a password login; with an SSH key, leave it empty
GENEALOGY_USER=       # the login that guards the tree itself
GENEALOGY_PASS=       # the password that guards the tree itself
```

`genealogy-user` / `genealogy-password` are the HTTP Basic credentials the service
asks for. Compose refuses to start without them, so the tree cannot end up on the
open internet unprotected by accident.

The commands below that call `ssh` or `curl` directly need them in the shell too:

```bash
set -a; . ./.env; set +a
```

Everything else goes through the `Makefile`, which reads `.env` itself and already
knows the SSH options. Never print the values.

## Procedure

### 1. Check the local tools

```bash
command -v docker && docker buildx version && docker compose version
command -v node && node -v
command -v curl
```

Only when a password login is used:

```bash
command -v sshpass || brew install hudochenkov/sshpass/sshpass
```

### 2. Check that the code is sound

Never ship a build that does not pass.

```bash
make check
```

If anything fails, fix it first. Do not deploy a red tree.

### 3. Back up the tree that is running now

Skip only if the service has never been deployed to this host. On a server still
running the memory version this is the only copy that survives the deploy.

```bash
make backup
```

It writes `backups/persons_<date>.zip` and keeps the five newest. Confirm the file
is there and is not empty:

```bash
ls -lh backups/ | tail -3
```

If the backup fails but the service is running, **stop**. Find out why before you
replace the container. A deploy without a backup risks the tree.

### 4. Check the server has docker

```bash
sshpass -e ssh -o StrictHostKeyChecking=no root@$PROD_HOST "docker --version && docker compose version"
```

If that fails, install Docker Engine and the compose plugin (Ubuntu/Debian):

```bash
sshpass -e ssh -o StrictHostKeyChecking=no root@$PROD_HOST "apt-get update && apt-get install -y ca-certificates curl gnupg"
sshpass -e ssh -o StrictHostKeyChecking=no root@$PROD_HOST "install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && chmod a+r /etc/apt/keyrings/docker.gpg"
sshpass -e ssh -o StrictHostKeyChecking=no root@$PROD_HOST "echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable\" > /etc/apt/sources.list.d/docker.list"
sshpass -e ssh -o StrictHostKeyChecking=no root@$PROD_HOST "apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && systemctl enable --now docker"
```

### 5. Build and ship

One target does the whole thing: build for `linux/amd64`, save to a tarball, copy
the tarball, `.env` and the compose file over, load the image, recreate the
container, delete the tarball and prune the image it replaced.

```bash
make deploy
```

Read its output. It ends with `docker ps` and the container's first log lines.

### 6. Confirm the container is up

```bash
make ps
```

Expect `Up ... (healthy)`. `starting` is fine for the first few seconds; `unhealthy`
or `Restarting` is not — go to the failure checklist.

### 7. Smoke-check the deployed instance

```bash
make smoke BASE=http://$PROD_HOST:5179
```

Every line must say `ok`. "people in the tree: 0" is expected only on a brand new
server or on the first deploy after the memory version — then step 9 follows.

### 8. Check disk hygiene on the server

```bash
make ps
```

It also prints `df -h /` and `docker system df`. If the disk is tight, reclaim
space — this only removes unused data, never the running container:

```bash
sshpass -e ssh -o StrictHostKeyChecking=no root@$PROD_HOST "docker image prune -f && docker builder prune -f"
sshpass -e ssh -o StrictHostKeyChecking=no root@$PROD_HOST "journalctl --vacuum-size=200M"
```

### 9. Put the tree back, if it is missing

Only when step 7 reported 0 people but the backup from step 3 has some. A folder
takes an archive only while it holds no tree, so this can never overwrite one
(it answers 409 instead):

```bash
make restore FILE=backups/<the file from step 3>
```

It answers `{"ok":true,"people":N,...}`. Check that `N` matches what was there
before. You can also do it from the browser: while the tree is empty the panel
shows **Upload archive**.

### 10. Look at it

Open `http://<production-host>:5179` in a browser, enter the login and password,
and confirm the tree is the one you expect.

## Failure checklist

Read the logs before changing any code:

```bash
make logs N=200
```

Common causes:

- **`required variable GENEALOGY_USER is missing`** — no `.env` on the server, or it
  is empty. `make deploy` writes it; check `$GENEALOGY_USER` / `$GENEALOGY_PASS`
  were exported.
- **The container restarts in a loop** — read the logs; usually the port is taken
  by something else on the host.
- **401 in the browser and you are sure the password is right** — the `.env` on the
  server is from an older deploy. Re-run `make deploy` with the right values.
- **The page loads but the tree is empty** — the first deploy after the memory
  version, or `data/` was lost. Step 9.
- **The container cannot write the tree** (`EACCES` in the logs) — `data/` on the
  server is not owned by uid 1000; `make deploy` chowns it, re-run it.
- **429 for the backup or the smoke check** — this address sent 5 wrong passwords
  in 15 minutes and is locked out for 15 minutes. Wait, and fix the password.
- **`docker load` fails or the image is missing** — the tarball did not arrive in
  full; check the disk on the server and re-run `make deploy`.
- **Disk full** — old images in `/var/lib/docker/overlay2`. Prune them, step 8.

Fix the smallest real cause, then repeat the cycle from step 2.

## Things to keep in mind

- Basic auth over plain HTTP sends the password in clear text. On an untrusted
  network put TLS in front (a reverse proxy with a certificate), or reach the
  service through an SSH tunnel.
- The tree on the server's disk is a single copy. Run `make backup` regularly, and
  always before a deploy.
- Never point this skill at the local `persons/` folder. That is the real family
  tree; the remote instance only ever sees what you upload to it.

## After deployment

Write a conclusion with:
- what was deployed and to which host;
- how many people were restored in step 9;
- issues found, if any;
- the final result: success or failure.

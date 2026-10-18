# Makefile for genealogy
#
# Build the image here, ship it to the remote machine and run it. The server
# never compiles anything: it receives a ready image as a tarball and loads it.
#
#   make build_docker                                    # build the amd64 image
#   make check                                           # typecheck + tests
#   make run_local                                       # try the image on this machine
#   make smoke                                           # check a running instance
#   make clean                                           # remove the image and the tarball
#   make backup / make restore FILE=backups/<file>.zip   # take the tree off / put it into an empty server
#
#   cp .env.example .env    # once: fill in the server and the passwords
#   make deploy
#
# The server's address and the passwords live in .env next to this file, which
# git ignores and the image never sees. A value on the command line still wins:
# `make backup PROD_HOST=1.2.3.4`. SSHPASS is only needed for a password login;
# with a key, leave it out. GENEALOGY_USER/GENEALOGY_PASS are the login to the
# tree itself — deploy writes them into .env on the server, never into the
# repository.

-include .env
export PROD_HOST SSH_USER SSHPASS GENEALOGY_USER GENEALOGY_PASS GENEALOGY_ADMIN_USER GENEALOGY_ADMIN_PASS

IMAGE         := genealogy_app:latest
PLATFORM      := linux/amd64            # the remote machine's architecture
REMOTE_DIR    := /root/genealogy
SSH_USER      ?= root
TARBALL       := genealogy_app.tar.gz
LOCAL_TARBALL := /tmp/$(TARBALL)
PORT          ?= 5179
BACKUP_DIR    ?= backups

# ControlPath=none keeps a stale multiplexing master from the user's ~/.ssh/config
# out of the way; it used to make a deploy fail with a broken pipe.
SSH_OPTS := -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/genealogy_known_hosts \
            -o ControlPath=none -o ControlMaster=no
# With a password, keys must be switched off outright: ssh offers every key it has
# first, the server counts each one as a failed attempt and refuses the password
# before it is ever asked. Without SSHPASS we go the usual key way.
PW_OPTS  := $(if $(SSHPASS),-o PubkeyAuthentication=no -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1,)
SSH := $(if $(SSHPASS),sshpass -e ssh,ssh) $(SSH_OPTS) $(PW_OPTS) $(SSH_USER)@$(PROD_HOST)
SCP := $(if $(SSHPASS),sshpass -e scp,scp) $(SSH_OPTS) $(PW_OPTS)

.PHONY: build_docker check run_local stop_local smoke save deploy logs applog applog_grep ps backup restore clean need_host need_pass

## check: typecheck, build and the whole test suite. The build comes before the tests:
##        one of them fetches the built page from a test server.
check:
	npm run typecheck
	npm run build
	npm test

## build_docker: build the image locally, cross-built for the server arch.
build_docker:
	docker buildx build --platform $(PLATFORM) -t $(IMAGE) --load .

## run_local: run the built image on this machine, to look at it before shipping.
run_local:
	@test -n "$$GENEALOGY_USER" || { echo "Set GENEALOGY_USER=<login>"; exit 1; }
	@test -n "$$GENEALOGY_PASS" || { echo "Set GENEALOGY_PASS=<password>"; exit 1; }
	-docker rm -f genealogy_local
	docker run -d --name genealogy_local --memory=256m \
		-e GENEALOGY_USER -e GENEALOGY_PASS \
		-e GENEALOGY_ADMIN_USER -e GENEALOGY_ADMIN_PASS \
		-p $(PORT):5179 $(IMAGE)
	@echo "http://127.0.0.1:$(PORT)"

## stop_local: stop that local container.
stop_local:
	-docker rm -f genealogy_local

## smoke: check a running instance. BASE defaults to the local container.
smoke:
	node tools/smoke.mjs $(or $(BASE),http://127.0.0.1:$(PORT)) $(GENEALOGY_USER) $(GENEALOGY_PASS)

## save: build, then save the image into a compressed tarball.
save: build_docker
	docker save $(IMAGE) | gzip > $(LOCAL_TARBALL)
	@du -h $(LOCAL_TARBALL)

need_host:
	@test -n "$(PROD_HOST)" || { echo "Set PROD_HOST=<server ip> in .env"; exit 1; }

need_pass:
	@test -n "$$GENEALOGY_USER" || { echo "Set GENEALOGY_USER=<login for the tree> in .env"; exit 1; }
	@test -n "$$GENEALOGY_PASS" || { echo "Set GENEALOGY_PASS=<password for the tree> in .env"; exit 1; }

## deploy: ship the image to the server and (re)start the container.
##         The tree lives in $(REMOTE_DIR)/data on the server and survives it.
##         Nothing ships while `make check` is red.
deploy: need_host need_pass check save
	$(SSH) "mkdir -p $(REMOTE_DIR)/logs $(REMOTE_DIR)/data"
	# the container runs as uid 1000, so the bind-mounted folders must be its own
	$(SSH) "chown -R 1000:1000 $(REMOTE_DIR)/logs $(REMOTE_DIR)/data"
	# the password goes as a file with mode 600, not on a command line where it
	# would show up in the process list and in the shell history
	@umask 077 && printf 'GENEALOGY_USER=%s\nGENEALOGY_PASS=%s\nGENEALOGY_PORT=%s\nGENEALOGY_ADMIN_USER=%s\nGENEALOGY_ADMIN_PASS=%s\n' \
		"$$GENEALOGY_USER" "$$GENEALOGY_PASS" "$(PORT)" "$$GENEALOGY_ADMIN_USER" "$$GENEALOGY_ADMIN_PASS" > /tmp/genealogy.env
	$(SCP) /tmp/genealogy.env $(SSH_USER)@$(PROD_HOST):$(REMOTE_DIR)/.env
	@rm -f /tmp/genealogy.env
	$(SSH) "chmod 600 $(REMOTE_DIR)/.env"
	$(SCP) $(LOCAL_TARBALL) $(SSH_USER)@$(PROD_HOST):$(REMOTE_DIR)/$(TARBALL)
	$(SCP) docker-compose-prod.yml $(SSH_USER)@$(PROD_HOST):$(REMOTE_DIR)/docker-compose-prod.yml
	$(SSH) "gunzip -c $(REMOTE_DIR)/$(TARBALL) | docker load"
	$(SSH) "cd $(REMOTE_DIR) && docker compose -f docker-compose-prod.yml -p genealogy up -d --force-recreate app"
	$(SSH) "rm -f $(REMOTE_DIR)/$(TARBALL)"
	# the previous image is now an untagged <none> layer — it only takes up disk
	$(SSH) "docker image prune -f"
	$(SSH) "docker ps --filter name=genealogy_app"
	$(SSH) "docker logs --tail=40 genealogy_app" || true

## logs: the last lines from the container on the server.
logs: need_host
	$(SSH) "docker logs --tail=$(or $(N),200) genealogy_app"

## applog: the last lines of the request log, and what the rotation has kept.
applog: need_host
	$(SSH) "ls -lh $(REMOTE_DIR)/logs/"
	$(SSH) "tail -n $(or $(N),50) $(REMOTE_DIR)/logs/access.log"

## applog_grep: search the whole request log, gzipped history included.
##              PATTERN=<what to look for>
applog_grep: need_host
	@test -n "$(PATTERN)" || { echo "Set PATTERN=<text to look for>"; exit 1; }
	$(SSH) "grep -h -- '$(PATTERN)' $(REMOTE_DIR)/logs/access.log 2>/dev/null; \
	        zgrep -h -- '$(PATTERN)' $(REMOTE_DIR)/logs/access.log.*.gz 2>/dev/null; true"

## ps: what is running there and how much it eats.
ps: need_host
	$(SSH) "docker ps --filter name=genealogy_app"
	$(SSH) "docker stats --no-stream genealogy_app"
	$(SSH) "df -h / && docker system df"

## backup: take the tree off the server as an archive, photos included: the copy
##         that survives losing the server itself.
backup: need_host need_pass
	@mkdir -p $(BACKUP_DIR)
	curl -fsS -u "$$GENEALOGY_USER:$$GENEALOGY_PASS" \
		"http://$(PROD_HOST):$(PORT)/api/download" \
		-o "$(BACKUP_DIR)/persons_$$(date +%Y-%m-%d_%H-%M-%S).zip"
	@ls -lh $(BACKUP_DIR) | tail -5
	# keep the five newest, the rest are just clutter
	@ls -1t $(BACKUP_DIR)/persons_*.zip 2>/dev/null | tail -n +6 | xargs -r rm -f

## restore: put an archive into the server. It is taken only while the server's
##          folder holds no tree (a first deploy, or after losing the data); over a
##          tree it is refused with 409. FILE=backups/<file>.zip
restore: need_host need_pass
	@test -n "$(FILE)" || { echo "Set FILE=backups/<file>.zip"; exit 1; }
	curl -fsS -u "$$GENEALOGY_USER:$$GENEALOGY_PASS" \
		--data-binary @"$(FILE)" "http://$(PROD_HOST):$(PORT)/api/upload"
	@echo

## clean: remove the local image and the saved tarball.
clean:
	-docker rmi -f $(IMAGE)
	-rm -f $(LOCAL_TARBALL)

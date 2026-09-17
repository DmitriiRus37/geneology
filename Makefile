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
#
#   PROD_HOST=1.2.3.4 SSHPASS='<root password>' \
#   GENEALOGY_USER=fam GENEALOGY_PASS='<tree password>' make deploy
#
# SSHPASS is only needed for a password login; with a key, leave it out.
# GENEALOGY_USER/GENEALOGY_PASS are the login to the tree itself — they are
# written into .env on the server and never into the repository.

IMAGE         := genealogy_app:latest
PLATFORM      := linux/amd64            # the remote machine's architecture
REMOTE_DIR    := /root/genealogy
SSH_USER      ?= root
TARBALL       := genealogy_app.tar.gz
LOCAL_TARBALL := /tmp/$(TARBALL)
PORT          ?= 5179
BACKUP_DIR    ?= backups

SSH_OPTS := -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/genealogy_known_hosts
# with a password when SSHPASS is set, otherwise the usual key
SSH := $(if $(SSHPASS),sshpass -e ssh,ssh) $(SSH_OPTS) $(SSH_USER)@$(PROD_HOST)
SCP := $(if $(SSHPASS),sshpass -e scp,scp) $(SSH_OPTS)

.PHONY: build_docker check run_local stop_local smoke save deploy logs ps backup clean need_host need_pass

## check: typecheck and the whole test suite.
check:
	npm run typecheck
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
		-e GENEALOGY_USER -e GENEALOGY_PASS -p $(PORT):5179 $(IMAGE)
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
	@test -n "$(PROD_HOST)" || { echo "Set PROD_HOST=<server ip>"; exit 1; }

need_pass:
	@test -n "$$GENEALOGY_USER" || { echo "Set GENEALOGY_USER=<login for the tree>"; exit 1; }
	@test -n "$$GENEALOGY_PASS" || { echo "Set GENEALOGY_PASS=<password for the tree>"; exit 1; }

## deploy: ship the image to the server and (re)start the container.
##         The tree lives in the container's memory, so a deploy wipes it:
##         take the archive first, put it back afterwards.
deploy: need_host need_pass save
	$(SSH) "mkdir -p $(REMOTE_DIR)"
	# the password goes as a file with mode 600, not on a command line where it
	# would show up in the process list and in the shell history
	@umask 077 && printf 'GENEALOGY_USER=%s\nGENEALOGY_PASS=%s\nGENEALOGY_PORT=%s\n' \
		"$$GENEALOGY_USER" "$$GENEALOGY_PASS" "$(PORT)" > /tmp/genealogy.env
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

## ps: what is running there and how much it eats.
ps: need_host
	$(SSH) "docker ps --filter name=genealogy_app"
	$(SSH) "docker stats --no-stream genealogy_app"
	$(SSH) "df -h / && docker system df"

## backup: take the tree off the server as an archive. The tree is in memory,
##         so this is the only copy that survives a restart.
backup: need_host need_pass
	@mkdir -p $(BACKUP_DIR)
	curl -fsS -u "$$GENEALOGY_USER:$$GENEALOGY_PASS" \
		"http://$(PROD_HOST):$(PORT)/api/download" \
		-o "$(BACKUP_DIR)/persons_$$(date +%Y-%m-%d_%H-%M-%S).zip"
	@ls -lh $(BACKUP_DIR) | tail -5
	# keep the five newest, the rest are just clutter
	@ls -1t $(BACKUP_DIR)/persons_*.zip 2>/dev/null | tail -n +6 | xargs -r rm -f

## clean: remove the local image and the saved tarball.
clean:
	-docker rmi -f $(IMAGE)
	-rm -f $(LOCAL_TARBALL)

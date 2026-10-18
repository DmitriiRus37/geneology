---
name: backup-tree
description: Take the family tree off the remote genealogy instance as a zip archive, or put an archive back onto it. Use this skill when asked to back up, save, restore, download or upload the tree on the server.
---

The remote instance keeps the tree on the server's disk, in
`/root/genealogy/data`, so a restart, a reboot or a deploy keeps it. That disk is
still a single copy: **the archive taken by this skill is the one that survives
losing the server.** Run it before any deploy and on a regular basis otherwise.

This skill never touches the local `persons/` folder. That is the real family tree
on this machine, and the remote instance is a separate copy that only ever holds
what has been uploaded to it.

## Required inputs

`PROD_HOST`, `GENEALOGY_USER` and `GENEALOGY_PASS` live in `.env` at the repository
root, which git ignores; the `Makefile` reads it. Never write them anywhere else and
never commit them. If `.env` is missing, copy `.env.example` and ask the user for the
values. Stop immediately if any value is missing or empty. For a direct `curl`, load
them into the shell first, without printing them:

```bash
set -a; . ./.env; set +a
```

## Taking a backup

```bash
make backup
```

It writes `backups/persons_<date>_<time>.zip` and removes all but the five newest.
`backups/` is git-ignored on purpose: the family does not belong in the repository.

Then confirm the archive is real, not an empty shell:

```bash
ls -lh backups/ | tail -3
unzip -l "$(ls -1t backups/persons_*.zip | head -1)" | tail -3
```

An archive of a populated tree is tens of kilobytes (more with photos) and holds
one `.json` per person plus `_view.json`, and `photos/*.jpg` for the people who
have one. **A 22-byte archive means the instance is empty** — the
tree was already lost, or nobody has opened the page yet. Say so plainly rather
than reporting a successful backup.

## Restoring

The server takes an archive only while its folder holds no tree: a brand new
server, the first deploy after the memory version, or after losing `data/`. Over a
tree it answers 409 and changes nothing. There is no merge.

```bash
make restore FILE=backups/<file>
```

The answer is `{"ok":true,"people":N,...}`. Check `N` against what you expected.

The same thing from the browser: while the tree is empty the panel shows **Upload
archive**; pick the file. The sidebar then says how many people were loaded.

### Replacing a tree that is not empty

The API will not do it. It takes the user's explicit request, a `make backup` of
what is there now, and then emptying `/root/genealogy/data` on the server by hand
before `make restore`. Ask first, show what will be lost, and never do it on your
own.

## Seeding the remote instance from the local tree

The local `persons/` folder can be packed and uploaded, but **read it, never write
it**:

```bash
cd /Users/dmitriigurylev/work/genealogy && zip -r /tmp/persons_upload.zip persons -x '.*' -x '__MACOSX/*'
curl -fsS -u "$GENEALOGY_USER:$GENEALOGY_PASS" --data-binary @/tmp/persons_upload.zip "http://$PROD_HOST:5179/api/upload"
rm -f /tmp/persons_upload.zip
```

Do this only when explicitly asked. It puts the real family tree on a remote
machine; that is the user's call, not yours.

## What the archive contains

The same files that lie in `persons/`: one `<id>.json` per person, plus
`_view.json` with the canvas settings (timeline mode, gap, who is hidden), plus
`photos/<name>.jpg` for every photo a card shows. The
`persons/` prefix inside the archive is optional on upload — a flat archive of
`.json` cards works too, and macOS litter (`__MACOSX`, `._name`, `.DS_Store`) is
ignored.

## After the job

Say plainly:
- how many people are in the archive or were restored;
- where the file is;
- whether the instance was empty, if it was.

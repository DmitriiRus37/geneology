---
name: backup-tree
description: Take the family tree off the remote genealogy instance as a zip archive, or put an archive back onto it. Use this skill when asked to back up, save, restore, download or upload the tree on the server.
---

The remote instance keeps the tree in the container's memory. Nothing is written
to the server's disk — which is the point, and which means a restart, a reboot or
a deploy empties it. **The archive taken by this skill is the only copy that
survives.** Run it before any deploy and on a regular basis otherwise.

This skill never touches the local `persons/` folder. That is the real family tree
on this machine, and the remote instance is a separate copy that only ever holds
what has been uploaded to it.

## Required inputs

Stop immediately if any value is missing or empty. Do not write them into files in
the repository and do not commit them.

```text
production-host=      # IP address of the server
genealogy-user=       # the login that guards the tree
genealogy-password=   # the password that guards the tree
```

```bash
export PROD_HOST='<production-host>'
export GENEALOGY_USER='<genealogy-user>'
export GENEALOGY_PASS='<genealogy-password>'
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

An archive of a populated tree is tens of kilobytes and holds one `.json` per
person plus `_view.json`. **A 22-byte archive means the instance is empty** — the
tree was already lost, or nobody has opened the page yet. Say so plainly rather
than reporting a successful backup.

## Restoring

Uploading replaces the whole tree on the instance. There is no merge.

```bash
curl -fsS -u "$GENEALOGY_USER:$GENEALOGY_PASS" \
  --data-binary @backups/<file> \
  "http://$PROD_HOST:5179/api/upload"
```

The answer is `{"ok":true,"people":N,...}`. Check `N` against what you expected.

The same thing from the browser: open the service, press **Upload archive**, pick
the file. The sidebar then says how many people were loaded.

### Before restoring over a tree that is not empty

Ask first, and take a backup of what is there now:

```bash
make backup
```

Uploading is not undoable on the server — whatever was in memory is gone the moment
the archive lands.

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
`_view.json` with the canvas settings (timeline mode, gap, who is hidden). The
`persons/` prefix inside the archive is optional on upload — a flat archive of
`.json` cards works too, and macOS litter (`__MACOSX`, `._name`, `.DS_Store`) is
ignored.

## After the job

Say plainly:
- how many people are in the archive or were restored;
- where the file is;
- whether the instance was empty, if it was.

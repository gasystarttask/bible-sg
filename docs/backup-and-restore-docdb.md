## DocumentDB Backup and Restore (Linux)

Short procedure for Ubuntu and Arch Linux using MongoDB Database Tools.

### 1) Install tools

Ubuntu:
```bash
sudo apt update
sudo apt install -y mongodb-database-tools
```

Arch:
```bash
sudo aura -A mongodb-tools-bin
```

Check:
```bash
mongodump --version
mongorestore --version
```

### 2) Backup (mongodump)

```bash
mkdir -p ./data/backup
mongodump \
	--uri="mongodb://admin:password@localhost:10260/?directConnection=true" \
	--ssl \
	--sslAllowInvalidCertificates \
	--sslAllowInvalidHostnames \
	--db=bible_sg \
	--out=./data/backup
```

Output will be BSON files in `./data/backup/bible_sg`.

### 3) Restore (mongorestore)

```bash
mongorestore \
	--uri="mongodb://admin:password@localhost:10260/?directConnection=true" \
	--ssl \
	--sslAllowInvalidCertificates \
	--sslAllowInvalidHostnames \
	--db=bible_sg \
	--drop \
	./data/backup/bible_sg
```

`--drop` removes existing collections before restore.

### 4) Init script (automation)

Use this when restoring automatically at container startup.

```bash
#!/usr/bin/env bash
set -euo pipefail

MONGO_URI="mongodb://admin:password@documentdb:10260/?directConnection=true"
BACKUP_PATH="/docker-entrypoint-initdb.d/backup/bible_sg"

mongorestore \
	--uri="$MONGO_URI" \
	--ssl \
	--sslAllowInvalidCertificates \
	--sslAllowInvalidHostnames \
	--db=bible_sg \
	--drop "$BACKUP_PATH"
echo "Restore completed"
```

### 5) Docker Compose mount example

```yaml
services:
	documentdb:
		image: ghcr.io/documentdb/documentdb/documentdb-local:latest

	app-or-init:
		image: your-image
		depends_on:
			- documentdb
		volumes:
			- ./init-db.sh:/docker-entrypoint-initdb.d/init-db.sh:ro
			- ./data/backup:/docker-entrypoint-initdb.d/backup:ro
```

### Quick checks

- Keep `mongodump`/`mongorestore` version compatible with server version.
- Use a user with `backup` and `restore` privileges.
- Do not edit `.bson` files manually.
- Indexes are recreated by `mongorestore`.

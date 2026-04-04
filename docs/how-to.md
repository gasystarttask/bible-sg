
# How To

## Run Database Locally with Docker Compose

To start the database locally, run:

```bash
docker compose -f ../db/compose.yml up -d
```

The database will be available and ready for development.

To stop the database:

```bash
docker compose -f ../db/compose.yml down
```

View logs:

```bash
docker compose -f ../db/compose.yml logs -f
```

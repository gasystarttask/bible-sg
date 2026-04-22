db = db.getSiblingDB('bible_sg');
db.createCollection('verses');
db.createCollection('entities');
db.createCollection('relations');

db.runCommand({
  createIndexes: "verses",
  indexes: [{
    key: { embedding: "cosmosSearch" },
    name: "vector_idx",
    cosmosSearchOptions: {
      kind: "vector-hnsw",
      similarity: "COS",
      dimensions: 1536
    }
  }]
});

/**
db.verses.createIndex({ entity_slugs: 1 });
db.entities.createIndex({ slug: 1 }, { unique: true });
db.relations.createIndex({ source_slug: 1 });
db.relations.createIndex({ source_entity_id: 1 });
 */
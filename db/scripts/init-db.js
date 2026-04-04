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
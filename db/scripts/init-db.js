db = db.getSiblingDB('books');
db.createCollection('verses').catch(() => {});
db.createCollection('entities').catch(() => {});
db.createCollection('relations').catch(() => {});
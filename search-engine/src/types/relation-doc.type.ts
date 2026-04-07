import { ObjectId } from "mongodb"
import { RawEntity, RawRelation } from "./entity.type";

export type ResolvedEntity = RawEntity & {
  aliases: string[]
}

export type EntityDoc = RawEntity & {
  _id?: ObjectId
  aliases?: string[]
  description_fragments?: string[]
  created_at: Date
  updated_at: Date
}

export type RelationDoc = RawRelation & {
  _id?: ObjectId
  source_entity_id: ObjectId
  target_entity_id: ObjectId
  evidence_verse_ids?: string[]
  created_at: Date
  updated_at: Date
}
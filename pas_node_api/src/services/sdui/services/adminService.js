'use strict';

const { getDB } = require('../db');

const SNAPSHOT_MAX = 10; // max snapshots kept per document

/**
 * Get all SDUI config documents.
 */
async function getAllDocs() {
  const db = await getDB();
  return db.collection('sdui_config').find({}).toArray();
}

/**
 * Replace one SDUI config document in full (PUT).
 */
async function updateDoc(id, doc) {
  const db = await getDB();
  doc._id = id;
  await db.collection('sdui_config').replaceOne({ _id: id }, doc, { upsert: true });
}

/**
 * Patch a single top-level field (flag or visible).
 */
async function patchField(id, field, value) {
  const db = await getDB();
  await db.collection('sdui_config').updateOne(
    { _id: id },
    { $set: { [field]: value } }
  );
}

/**
 * Delete one SDUI config document.
 */
async function deleteDoc(id) {
  const db = await getDB();
  await db.collection('sdui_config').deleteOne({ _id: id });
}

// ─── Version Control / Snapshots ──────────────────────────

/**
 * Save a snapshot of the current document state before a write operation.
 * Keeps at most SNAPSHOT_MAX snapshots per document (oldest pruned).
 */
async function saveSnapshot(id) {
  const db = await getDB();
  const doc = await db.collection('sdui_config').findOne({ _id: id });
  if (!doc) return;

  await db.collection('sdui_snapshots').insertOne({
    originalId: id,
    savedAt: new Date(),
    snapshot: doc,
  });

  // Prune oldest beyond limit
  const all = await db.collection('sdui_snapshots')
    .find({ originalId: id })
    .sort({ savedAt: -1 })
    .toArray();

  if (all.length > SNAPSHOT_MAX) {
    const toDelete = all.slice(SNAPSHOT_MAX).map(s => s._id);
    await db.collection('sdui_snapshots').deleteMany({ _id: { $in: toDelete } });
  }
}

/**
 * Get all snapshots for a document, newest first.
 */
async function getSnapshots(originalId) {
  const db = await getDB();
  return db.collection('sdui_snapshots')
    .find({ originalId })
    .sort({ savedAt: -1 })
    .toArray();
}

/**
 * Restore a document from a snapshot.
 * Saves a snapshot of the current state first so nothing is lost.
 */
async function restoreSnapshot(snapshotId) {
  const { ObjectId } = require('mongodb');
  const db = await getDB();

  let oid;
  try { oid = new ObjectId(snapshotId); } catch { oid = snapshotId; }

  const snap = await db.collection('sdui_snapshots').findOne({ _id: oid });
  if (!snap) throw new Error('Snapshot not found');

  const restoredDoc = snap.snapshot;
  const originalId  = snap.originalId;

  // Save current state before overwriting
  await saveSnapshot(originalId);

  // Restore
  await db.collection('sdui_config').replaceOne(
    { _id: originalId },
    restoredDoc,
    { upsert: true }
  );

  return restoredDoc;
}

// ─── Single Doc ──────────────────────────────────────────

/**
 * Get a single SDUI config document by _id.
 */
async function getDoc(id) {
  const db = await getDB();
  return db.collection('sdui_config').findOne({ _id: id });
}

/**
 * Create a new SDUI config document (POST).
 * Throws if _id already exists.
 * Auto-shifts ranks: all docs with same config_type and rank >= doc.rank are incremented by 1.
 */
async function createDoc(doc) {
  const db = await getDB();
  if (!doc._id) throw new Error('_id is required');
  const existing = await db.collection('sdui_config').findOne({ _id: doc._id });
  if (existing) throw new Error(`Document '${doc._id}' already exists`);
  doc.created_at = doc.created_at || new Date().toISOString();
  if (!doc.filters) doc.filters = [];

  // Shift existing docs with same config_type and rank >= new doc's rank
  if (doc.rank != null && doc.config_type) {
    await db.collection('sdui_config').updateMany(
      { config_type: doc.config_type, rank: { $gte: doc.rank } },
      { $inc: { rank: 1 } }
    );
  }

  await db.collection('sdui_config').insertOne(doc);
  return doc;
}

// ─── Filter CRUD (within a doc) ─────────────────────────

/**
 * Add a filter to a document's filters array.
 * Auto-shifts ranks: all filters in the doc with rank >= filter.rank are incremented by 1.
 */
async function addFilter(docId, filter) {
  const db = await getDB();
  if (!filter._id) throw new Error('filter._id is required');
  filter.options = filter.options || [];

  // Shift existing filters with rank >= new filter's rank
  if (filter.rank != null) {
    await db.collection('sdui_config').updateOne(
      { _id: docId },
      { $inc: { 'filters.$[f].rank': 1 } },
      { arrayFilters: [{ 'f.rank': { $gte: filter.rank } }] }
    );
  }

  await db.collection('sdui_config').updateOne(
    { _id: docId },
    { $push: { filters: filter } }
  );
}

/**
 * Update a filter inside a document's filters array.
 */
async function updateFilter(docId, filterId, updates) {
  const db = await getDB();
  const setFields = {};
  for (const [key, val] of Object.entries(updates)) {
    if (key === '_id' || key === 'options') continue; // don't overwrite _id or options via this route
    setFields[`filters.$[f].${key}`] = val;
  }
  if (Object.keys(setFields).length === 0) return;
  await db.collection('sdui_config').updateOne(
    { _id: docId },
    { $set: setFields },
    { arrayFilters: [{ 'f._id': filterId }] }
  );
}

/**
 * Delete a filter from a document's filters array.
 */
async function deleteFilter(docId, filterId) {
  const db = await getDB();
  await db.collection('sdui_config').updateOne(
    { _id: docId },
    { $pull: { filters: { _id: filterId } } }
  );
}

// ─── Option CRUD (within a filter) ──────────────────────

/**
 * Add an option to a filter's options array.
 * Auto-shifts ranks: all options in the filter with rank >= option.rank are incremented by 1.
 */
async function addOption(docId, filterId, option) {
  const db = await getDB();
  if (!option._id) throw new Error('option._id is required');

  // Shift existing options via read-modify-write (nested arrays require this approach)
  if (option.rank != null) {
    const doc = await db.collection('sdui_config').findOne({ _id: docId });
    if (doc) {
      const filter = (doc.filters || []).find(f => f._id === filterId);
      if (filter) {
        let shifted = false;
        for (const opt of (filter.options || [])) {
          if (opt.rank != null && opt.rank >= option.rank) {
            opt.rank += 1;
            shifted = true;
          }
        }
        if (shifted) {
          await db.collection('sdui_config').replaceOne({ _id: docId }, doc);
        }
      }
    }
  }

  await db.collection('sdui_config').updateOne(
    { _id: docId, 'filters._id': filterId },
    { $push: { 'filters.$.options': option } }
  );
}

/**
 * Update an option inside a filter's options array.
 */
async function updateOption(docId, filterId, optionId, updates) {
  const db = await getDB();
  // MongoDB doesn't support nested arrayFilters easily, so read-modify-write
  const doc = await db.collection('sdui_config').findOne({ _id: docId });
  if (!doc) throw new Error('Document not found');
  const filter = (doc.filters || []).find(f => f._id === filterId);
  if (!filter) throw new Error('Filter not found');
  const option = (filter.options || []).find(o => o._id === optionId);
  if (!option) throw new Error('Option not found');
  Object.assign(option, updates, { _id: optionId }); // preserve _id
  await db.collection('sdui_config').replaceOne({ _id: docId }, doc);
}

/**
 * Delete an option from a filter's options array.
 */
async function deleteOption(docId, filterId, optionId) {
  const db = await getDB();
  const doc = await db.collection('sdui_config').findOne({ _id: docId });
  if (!doc) throw new Error('Document not found');
  const filter = (doc.filters || []).find(f => f._id === filterId);
  if (!filter) throw new Error('Filter not found');
  filter.options = (filter.options || []).filter(o => o._id !== optionId);
  await db.collection('sdui_config').replaceOne({ _id: docId }, doc);
}

module.exports = {
  getAllDocs, getDoc, createDoc, updateDoc, patchField, deleteDoc,
  addFilter, updateFilter, deleteFilter,
  addOption, updateOption, deleteOption,
  saveSnapshot, getSnapshots, restoreSnapshot,
};

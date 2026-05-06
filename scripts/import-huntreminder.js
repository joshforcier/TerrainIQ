#!/usr/bin/env node
/*
  Imports hunt reminder data into Firestore `applications` collection.

  Usage:
    node scripts/import-huntreminder.js
    node scripts/import-huntreminder.js --replace
    node scripts/import-huntreminder.js --project terrainiq --key ./terrainiq-firebase-adminsdk-fbsvc-74ea9dcbdb.json

  Notes:
    - Requires Admin SDK credentials, e.g. GOOGLE_APPLICATION_CREDENTIALS.
    - Source endpoint: https://api.huntreminder.com/api/reminders
*/

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

const SOURCE_URL = 'https://api.huntreminder.com/api/reminders';
const BATCH_LIMIT = 450;
const DEFAULT_PROJECT_ID = 'terrainiq';
const DEFAULT_KEY_PATH = 'terrainiq-firebase-adminsdk-fbsvc-74ea9dcbdb.json';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function argValue(name, fallback = '') {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildApplicationDoc(reminder) {
  const state = String(reminder.state || '').trim();
  const species = String(reminder.animal || '').trim();
  const description = String(reminder.description || '').trim();
  const startDate = toDate(reminder.startDate);
  const endDate = toDate(reminder.endDate);

  if (!state || !species || !endDate) {
    return null;
  }

  const reminderId = String(reminder.reminderId || '').trim();
  const fallbackId = `${normalizeKey(state)}_${normalizeKey(species)}_${normalizeKey(description || 'deadline')}`;
  const id = reminderId
    ? `${normalizeKey(state)}_${normalizeKey(species)}_${reminderId}`
    : fallbackId;

  const name = description || 'Application Deadline';

  return {
    docId: id,
    data: {
      id,
      state,
      species,
      name,
      startDate,
      deadline: endDate,
      source: 'huntreminder',
      sourceReminderId: reminder.reminderId || null,
      sourceUrl: reminder.url || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
}

async function fetchReminders() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const reminders = Array.isArray(json?.reminders) ? json.reminders : [];
  return reminders;
}

async function deleteAllApplications(db) {
  const snapshot = await db.collection('applications').get();
  if (snapshot.empty) return 0;

  let deleted = 0;
  let batch = db.batch();
  let count = 0;

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    count += 1;
    deleted += 1;

    if (count >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  return deleted;
}

async function upsertApplications(db, docs) {
  let written = 0;
  let batch = db.batch();
  let count = 0;

  for (const item of docs) {
    const ref = db.collection('applications').doc(item.docId);
    batch.set(ref, item.data, { merge: true });
    count += 1;
    written += 1;

    if (count >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  return written;
}

async function initAdmin() {
  const keyPath = argValue('--key', path.resolve(process.cwd(), DEFAULT_KEY_PATH));
  const projectId = argValue('--project', DEFAULT_PROJECT_ID);

  try {
    const serviceAccount = JSON.parse(await readFile(keyPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || projectId,
    });
    console.log(`Target project: ${serviceAccount.project_id || projectId}`);
  } catch (error) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
    console.log(`Target project: ${projectId}`);
    console.warn(`Using application default credentials; service account file not loaded from ${keyPath}.`);
  }
}

async function main() {
  const replace = hasFlag('--replace');

  await initAdmin();

  const db = admin.firestore();

  const reminders = await fetchReminders();
  const docs = reminders
    .map(buildApplicationDoc)
    .filter(Boolean);

  if (replace) {
    const deleted = await deleteAllApplications(db);
    console.log(`Deleted ${deleted} existing applications docs.`);
  }

  const written = await upsertApplications(db, docs);
  console.log(`Imported ${written} reminder records into applications.`);
}

main().catch((error) => {
  console.error('Import failed:', error.message || error);
  process.exit(1);
});



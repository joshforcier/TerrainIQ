#!/usr/bin/env node
/*
  Migrates TrophyTrack Firestore data into RidgeRead.

  Default mode is a dry run. Add --write to actually write to RidgeRead.

  Defaults assume this repo sits next to TrophyTrack:
    source key: ../TrophyTrack/functions/trophy-track-firebase-adminsdk-e8yri-44a7f00e23.json
    target key: ./terrainiq-firebase-adminsdk-fbsvc-74ea9dcbdb.json

  Examples:
    npm run migrate:trophytrack
    npm run migrate:trophytrack -- --write
    npm run migrate:trophytrack -- --write --catalog-only
    npm run migrate:trophytrack -- --write --users-only
*/

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import admin from 'firebase-admin'

const BATCH_LIMIT = 450
const DEFAULT_CATALOG_COLLECTIONS = ['applications', 'huntUnits', 'drawOdds', 'manualApplications']

function hasFlag(flag) {
  return process.argv.includes(flag)
}

function argValue(name, fallback = '') {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1]
  }
  return fallback
}

function csvArg(name, fallback) {
  const raw = argValue(name, '')
  if (!raw) return fallback
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function resolveDefaultPaths() {
  const cwd = process.cwd()
  return {
    sourceKey: path.resolve(
      cwd,
      '..',
      'TrophyTrack',
      'functions',
      'trophy-track-firebase-adminsdk-e8yri-44a7f00e23.json',
    ),
    targetKey: path.resolve(cwd, 'terrainiq-firebase-adminsdk-fbsvc-74ea9dcbdb.json'),
  }
}

async function loadServiceAccount(filePath) {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function initFirebaseApp(name, serviceAccountPath) {
  const serviceAccount = await loadServiceAccount(serviceAccountPath)
  const app = admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    },
    name,
  )
  return {
    app,
    projectId: serviceAccount.project_id,
    db: admin.firestore(app),
    auth: admin.auth(app),
  }
}

function dryLog(write, message) {
  console.log(`${write ? '[write]' : '[dry-run]'} ${message}`)
}

async function commitBatch(write, batch, count) {
  if (count === 0) return
  if (write) await batch.commit()
}

async function deleteCollection(db, collectionPath, write) {
  const snapshot = await db.collection(collectionPath).get()
  let deleted = 0
  let batch = db.batch()
  let count = 0

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref)
    deleted += 1
    count += 1
    if (count >= BATCH_LIMIT) {
      await commitBatch(write, batch, count)
      batch = db.batch()
      count = 0
    }
  }

  await commitBatch(write, batch, count)
  return deleted
}

async function copyCollection({ sourceDb, targetDb, collectionName, write, replace }) {
  if (replace) {
    const deleted = await deleteCollection(targetDb, collectionName, write)
    dryLog(write, `${collectionName}: ${deleted} existing target docs ${write ? 'deleted' : 'would be deleted'}`)
  }

  const snapshot = await sourceDb.collection(collectionName).get()
  let written = 0
  let batch = targetDb.batch()
  let count = 0

  for (const doc of snapshot.docs) {
    batch.set(targetDb.collection(collectionName).doc(doc.id), doc.data(), { merge: true })
    written += 1
    count += 1
    if (count >= BATCH_LIMIT) {
      await commitBatch(write, batch, count)
      batch = targetDb.batch()
      count = 0
    }
  }

  await commitBatch(write, batch, count)
  dryLog(write, `${collectionName}: ${written} docs ${write ? 'copied' : 'would be copied'}`)
  return written
}

async function copyDocumentWithSubcollections({ sourceRef, targetRef, write, merge = true }) {
  const sourceSnap = await sourceRef.get()
  let docs = 0
  if (sourceSnap.exists) {
    if (write) await targetRef.set(sourceSnap.data(), { merge })
    docs += 1
  }

  const subcollections = await sourceRef.listCollections()
  for (const sourceSubcollection of subcollections) {
    docs += await copySubcollectionRecursive({
      sourceCollection: sourceSubcollection,
      targetCollection: targetRef.collection(sourceSubcollection.id),
      write,
    })
  }
  return docs
}

async function copySubcollectionRecursive({ sourceCollection, targetCollection, write }) {
  const snapshot = await sourceCollection.get()
  let docs = 0

  for (const sourceDoc of snapshot.docs) {
    const targetDoc = targetCollection.doc(sourceDoc.id)
    if (write) await targetDoc.set(sourceDoc.data(), { merge: true })
    docs += 1

    const nested = await sourceDoc.ref.listCollections()
    for (const nestedCollection of nested) {
      docs += await copySubcollectionRecursive({
        sourceCollection: nestedCollection,
        targetCollection: targetDoc.collection(nestedCollection.id),
        write,
      })
    }
  }

  return docs
}

async function listUsersByEmail(auth) {
  const byEmail = new Map()
  let pageToken

  do {
    const result = await auth.listUsers(1000, pageToken)
    for (const user of result.users) {
      const email = String(user.email || '').trim().toLowerCase()
      if (email) byEmail.set(email, user)
    }
    pageToken = result.pageToken
  } while (pageToken)

  return byEmail
}

async function migrateUsers({ source, target, write }) {
  const sourceUsers = await listUsersByEmail(source.auth)
  const targetUsers = await listUsersByEmail(target.auth)
  const skipped = []
  let matched = 0
  let docsTouched = 0

  for (const [email, sourceUser] of sourceUsers.entries()) {
    const targetUser = targetUsers.get(email)
    if (!targetUser) {
      skipped.push({ email, sourceUid: sourceUser.uid, reason: 'no matching RidgeRead auth user' })
      continue
    }

    matched += 1
    const sourceUserRef = source.db.collection('users').doc(sourceUser.uid)
    const targetUserRef = target.db.collection('users').doc(targetUser.uid)

    docsTouched += await copyDocumentWithSubcollections({
      sourceRef: sourceUserRef,
      targetRef: targetUserRef,
      write,
    })

    if (write) {
      await targetUserRef.set(
        {
          migratedFrom: {
            app: 'TrophyTrack',
            uid: sourceUser.uid,
            email,
            migratedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      )
    }
  }

  dryLog(write, `users: ${matched} users matched by email; ${docsTouched} user docs/subdocs ${write ? 'copied' : 'would be copied'}`)
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} TrophyTrack auth users with no RidgeRead auth match:`)
    for (const item of skipped.slice(0, 50)) {
      console.log(`  - ${item.email || '(no email)'} (${item.sourceUid}): ${item.reason}`)
    }
    if (skipped.length > 50) console.log(`  ...and ${skipped.length - 50} more`)
  }
}

async function main() {
  const defaults = resolveDefaultPaths()
  const write = hasFlag('--write')
  const catalogOnly = hasFlag('--catalog-only')
  const usersOnly = hasFlag('--users-only')
  const replaceCatalogs = hasFlag('--replace-catalogs')
  const collections = csvArg('--collections', DEFAULT_CATALOG_COLLECTIONS)
  const sourceKey = path.resolve(argValue('--source-key', process.env.TROPHY_TRACK_SERVICE_ACCOUNT || defaults.sourceKey))
  const targetKey = path.resolve(argValue('--target-key', process.env.RIDGEREAD_SERVICE_ACCOUNT || defaults.targetKey))

  if (catalogOnly && usersOnly) {
    throw new Error('Use only one of --catalog-only or --users-only.')
  }

  const source = await initFirebaseApp('trophytrack-source', sourceKey)
  const target = await initFirebaseApp('ridgeread-target', targetKey)

  console.log(`Source project: ${source.projectId}`)
  console.log(`Target project: ${target.projectId}`)
  if (!write) console.log('Dry run only. Re-run with --write to write data.')

  if (!usersOnly) {
    for (const collectionName of collections) {
      await copyCollection({
        sourceDb: source.db,
        targetDb: target.db,
        collectionName,
        write,
        replace: replaceCatalogs,
      })
    }
  }

  if (!catalogOnly) {
    await migrateUsers({ source, target, write })
  }

  console.log('Migration complete.')
}

main().catch((error) => {
  console.error('Migration failed:', error.message || error)
  process.exit(1)
})

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

admin.initializeApp();

const db = admin.firestore();
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || 'joshforcier@gmail.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toUtcDay(value) {
  const date = toDate(value);
  if (!date) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysUntil(value, now = new Date()) {
  const deadline = toUtcDay(value);
  const today = toUtcDay(now);
  if (!deadline || !today) return null;
  return Math.round((deadline.getTime() - today.getTime()) / DAY_MS);
}

function getTriggerKind(app, now = new Date()) {
  const deadlineDays = daysUntil(app.deadline, now);
  if (deadlineDays === 7) return 'close-7';
  if (deadlineDays === 1) return 'close-1';
  if (app.openDate && daysUntil(app.openDate, now) === 0) return 'opened';
  return null;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function buildNotificationId(state, species, name) {
  return `${normalizeKey(state)}_${normalizeKey(species)}_${normalizeKey(name)}`;
}

function firstString(data, keys) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      if (typeof value.name === 'string' && value.name.trim()) return value.name.trim();
      if (typeof value.label === 'string' && value.label.trim()) return value.label.trim();
      if (typeof value.value === 'string' && value.value.trim()) return value.value.trim();
    }
  }
  return '';
}

function firstDate(data, keys) {
  for (const key of keys) {
    const parsed = toDate(data[key]);
    if (parsed) return parsed;
  }
  return null;
}

function deriveCatalogParts(id) {
  const parts = String(id || '').split(/[_-]+/).filter(Boolean);
  return {
    state: parts[0] || '',
    species: parts[1] || '',
    name: parts.slice(2).join(' '),
  };
}

function normalizeApplication(id, data) {
  const derived = deriveCatalogParts(id);
  const state = firstString(data, ['state', 'stateId', 'stateCode', 'stateName']) || derived.state;
  const species = firstString(data, ['species', 'gameSpecies', 'animal', 'huntSpecies']) || derived.species;
  const name = firstString(data, [
    'name',
    'notificationName',
    'title',
    'displayName',
    'applicationName',
    'deadlineName',
    'label',
  ]) || derived.name;
  const deadline = firstDate(data, [
    'deadline',
    'deadlineDate',
    'applicationDeadline',
    'closeDate',
    'closingDate',
    'endDate',
    'dueDate',
    'closesAt',
  ]);
  if (!state || !species || !name || !deadline) return null;
  return {
    id: String(data.id || id || buildNotificationId(state, species, name)),
    state,
    species,
    name,
    deadline,
    openDate: firstDate(data, ['openDate', 'openDateTime', 'openAt', 'opensAt', 'startDate', 'windowOpenDate']),
    applicationUrl: firstString(data, ['applicationUrl', 'url', 'sourceUrl', 'link', 'href']) || null,
  };
}

function createEmailTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user, pass },
  });
}

function createSmsGateway() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_PHONE;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || (!from && !messagingServiceSid)) return null;
  return { client: twilio(sid, token), from, messagingServiceSid };
}

function smsParams(gateway, body, to) {
  const params = { body, to };
  if (gateway.messagingServiceSid) params.messagingServiceSid = gateway.messagingServiceSid;
  else params.from = gateway.from;
  return params;
}

function buildHeadline(kind) {
  if (kind === 'opened') return 'Application window opened';
  if (kind === 'close-7') return 'Deadline closes in 7 days';
  if (kind === 'close-1') return 'Deadline closes tomorrow';
  return 'RidgeRead reminder';
}

function buildEmailHtml({ app, kind, note }) {
  const appUrl = process.env.RIDGEREAD_APP_URL || 'https://ridgeread.app';
  const headline = buildHeadline(kind);
  const safeNote = note ? `<p style="margin:14px 0 0;color:#475569;"><strong>Note:</strong> ${escapeHtml(note)}</p>` : '';
  const sourceLink = app.applicationUrl
    ? `<p style="margin:18px 0 0;"><a href="${escapeAttr(app.applicationUrl)}" style="color:#0f172a;font-weight:700;">Open application source</a></p>`
    : '';
  return `<!doctype html>
<html>
<body style="margin:0;background:#f3f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:28px 18px;">
    <div style="background:#ffffff;border:1px solid #d8ded8;border-radius:14px;overflow:hidden;">
      <div style="background:#0a0e14;color:#e8c547;padding:18px 22px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:12px;">RidgeRead</div>
      <div style="padding:24px 22px;">
        <h1 style="margin:0 0 10px;font-size:24px;line-height:1.15;color:#0f172a;">${escapeHtml(headline)}</h1>
        <p style="margin:0;color:#334155;font-size:16px;">${escapeHtml(app.state)} ${escapeHtml(app.species)} · ${escapeHtml(app.name)}</p>
        <p style="margin:14px 0 0;color:#475569;">Deadline: <strong>${escapeHtml(formatDate(app.deadline))}</strong></p>
        ${safeNote}
        ${sourceLink}
        <p style="margin:22px 0 0;"><a href="${escapeAttr(appUrl)}/notifications" style="display:inline-block;background:#e8c547;color:#111827;text-decoration:none;font-weight:800;padding:11px 16px;border-radius:9px;">Manage reminders</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildSms({ app, kind, note }) {
  const appUrl = process.env.RIDGEREAD_APP_URL || 'https://ridgeread.app';
  const noteText = note ? ` Note: ${note}` : '';
  return `RidgeRead: ${buildHeadline(kind)} — ${app.state} ${app.species} ${app.name}, deadline ${formatDate(app.deadline)}.${noteText} ${appUrl}/notifications`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function sendLogId(appId, kind, channel, deadline) {
  const dateKey = toDate(deadline).toISOString().slice(0, 10);
  return `${dateKey}_${kind}_${channel}_${appId}`.replace(/\//g, '_');
}

async function loadApplications() {
  const snapshot = await db.collection('applications').get();
  const apps = new Map();
  snapshot.forEach((doc) => {
    const app = normalizeApplication(doc.id, doc.data());
    if (app) apps.set(app.id, app);
  });
  return apps;
}

async function loadNotificationPreferenceDocs() {
  const snapshot = await db.collectionGroup('meta').get();
  return snapshot.docs.filter((doc) => doc.id === 'notifications' && doc.ref.parent.parent);
}

async function hasSendLog(prefRef, logId) {
  const snap = await prefRef.collection('sends').doc(logId).get();
  return snap.exists;
}

async function writeSendLog(prefRef, logId, payload) {
  await prefRef.collection('sends').doc(logId).set({
    ...payload,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function sendReminderToUser({ uid, prefRef, prefs, app, kind, force = false }) {
  const emailTransporter = createEmailTransporter();
  const smsGateway = createSmsGateway();
  const user = await admin.auth().getUser(uid).catch(() => null);
  const note = prefs.notes && typeof prefs.notes === 'object' ? prefs.notes[app.id] || '' : '';
  const result = { sentEmail: 0, sentSms: 0, skipped: 0 };

  if (prefs.emailEnabled !== false && user?.email && emailTransporter) {
    const logId = sendLogId(app.id, kind, 'email', app.deadline);
    if (force || !(await hasSendLog(prefRef, logId))) {
      await emailTransporter.sendMail({
        from: process.env.SMTP_FROM || process.env.REMINDER_FROM_EMAIL || process.env.SMTP_USER,
        to: user.email,
        subject: `RidgeRead: ${buildHeadline(kind)} — ${app.state} ${app.species}`,
        html: buildEmailHtml({ app, kind, note }),
      });
      await writeSendLog(prefRef, logId, { channel: 'email', kind, notificationId: app.id, deadline: app.deadline });
      result.sentEmail += 1;
    } else {
      result.skipped += 1;
    }
  }

  if (prefs.smsEnabled === true && prefs.phone && smsGateway) {
    const logId = sendLogId(app.id, kind, 'sms', app.deadline);
    if (force || !(await hasSendLog(prefRef, logId))) {
      await smsGateway.client.messages.create(smsParams(smsGateway, buildSms({ app, kind, note }), prefs.phone));
      await writeSendLog(prefRef, logId, { channel: 'sms', kind, notificationId: app.id, deadline: app.deadline });
      result.sentSms += 1;
    } else {
      result.skipped += 1;
    }
  }

  return result;
}

async function runDeadlineReminderPass(now = new Date()) {
  const apps = await loadApplications();
  const prefDocs = await loadNotificationPreferenceDocs();
  const totals = { evaluated: 0, sentEmail: 0, sentSms: 0, skipped: 0 };

  for (const prefDoc of prefDocs) {
    const uid = prefDoc.ref.parent.parent.id;
    const prefs = prefDoc.data();
    const ids = Array.isArray(prefs.ids) ? prefs.ids : [];
    for (const id of ids) {
      const app = apps.get(id);
      const kind = app ? getTriggerKind(app, now) : null;
      if (!app || !kind) continue;
      totals.evaluated += 1;
      const result = await sendReminderToUser({ uid, prefRef: prefDoc.ref, prefs, app, kind });
      totals.sentEmail += result.sentEmail;
      totals.sentSms += result.sentSms;
      totals.skipped += result.skipped;
    }
  }

  logger.info('RidgeRead deadline reminder pass complete', totals);
  return totals;
}

function assertAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const email = String(request.auth.token.email || '').toLowerCase();
  if (request.auth.token.admin === true || ADMIN_EMAILS.has(email)) return;
  throw new HttpsError('permission-denied', 'Admin access required.');
}

exports.sendDeadlineReminders = onSchedule(
  { schedule: '0 14 * * *', timeZone: 'UTC', region: 'us-central1', memory: '256MiB' },
  async () => {
    await runDeadlineReminderPass();
  },
);

exports.sendDeadlineRemindersNow = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    assertAdmin(request);
    return runDeadlineReminderPass();
  },
);

exports.sendTestReminder = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    assertAdmin(request);
    const notificationId = String(request.data?.notificationId || '');
    const uid = request.auth.uid;
    const prefRef = db.doc(`users/${uid}/meta/notifications`);
    const prefSnap = await prefRef.get();
    const prefs = prefSnap.exists ? prefSnap.data() : { ids: [] };
    const apps = await loadApplications();
    const app = apps.get(notificationId) || apps.get((prefs.ids || [])[0]);
    if (!app) throw new HttpsError('failed-precondition', 'No reminder is available to test.');
    return sendReminderToUser({ uid, prefRef, prefs, app, kind: 'test', force: true });
  },
);

exports.twilioInboundWebhook = onRequest(
  { region: 'us-central1', memory: '256MiB' },
  async (req, res) => {
    const message = String(req.body?.Body || '').trim();
    logger.info('RidgeRead inbound SMS received', { message });
    res.status(200).type('text/xml').send('<Response><Message>RidgeRead received your message. Manage reminders in the app.</Message></Response>');
  },
);

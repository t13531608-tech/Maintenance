/* ==========================================================================
   auth.js — تسجيل الدخول والجلسات وإدارة الحسابات

   ملاحظة أمنية: هذا المشروع يعمل بالكامل داخل المتصفح (بدون خادم)، لذلك
   كلمات المرور تُخزَّن كبصمة SHA-256 مملّحة في localStorage. هذا مناسب للعرض
   والتجربة فقط. في بيئة الإنتاج يجب نقل المصادقة إلى خادم (API + قاعدة بيانات)
   مع تجزئة bcrypt/argon2 وجلسات/JWT.
   ========================================================================== */
'use strict';

const SESSION_KEY = 'cmms_session_v2';
const FAILS_KEY = 'cmms_login_fails_v2';
const MAX_FAILS = 5;        // عدد المحاولات الفاشلة قبل القفل المؤقت
const LOCK_MS = 30 * 1000;  // مدة القفل

/* ---------- SHA-256 (تنفيذ متزامن يعمل حتى على file:// ) ---------- */
function sha256(message) {
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const primes = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
  const frac = (x) => Math.floor((x - Math.floor(x)) * 4294967296);
  const K = primes.map((p) => frac(Math.cbrt(p)));
  let H = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));

  const bytes = Array.from(new TextEncoder().encode(message));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 255);

  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4;
      w[t] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) | 0);
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

/** البصمة مملّحة باسم المستخدم حتى لا تتطابق بصمات كلمات المرور المتشابهة */
function hashPassword(username, password) {
  return sha256(`cmms:${String(username).trim().toLowerCase()}:${password}`);
}

function generatePassword(length = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/* ---------- الجلسة ---------- */
function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch (_) {
    return fallback;
  }
}

let session = readJson(SESSION_KEY, null);

/** المستخدم الحالي إن كانت الجلسة صالحة والحساب نشطاً */
function sessionUser() {
  if (!session) return null;
  const user = state.users.find((u) => u.id === session.userId);
  return user && user.active ? user : null;
}

function signOut() {
  session = null;
  try { localStorage.removeItem(SESSION_KEY); } catch (_) { /* تجاهل */ }
}

function attemptLogin(username, password) {
  const fails = readJson(FAILS_KEY, { count: 0, until: 0 });
  if (fails.until > Date.now()) {
    const secs = Math.ceil((fails.until - Date.now()) / 1000);
    return { ok: false, error: `تم إيقاف المحاولات مؤقتاً. حاول مرة أخرى بعد ${secs} ثانية` };
  }

  const name = String(username).trim().toLowerCase();
  const user = state.users.find((u) => u.username === name);
  const valid = user && user.passHash === hashPassword(user.username, password);

  if (!valid) {
    fails.count += 1;
    if (fails.count >= MAX_FAILS) { fails.until = Date.now() + LOCK_MS; fails.count = 0; }
    try { localStorage.setItem(FAILS_KEY, JSON.stringify(fails)); } catch (_) { /* تجاهل */ }
    return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  }
  if (!user.active) return { ok: false, error: 'هذا الحساب موقوف. تواصل مع مدير النظام' };

  try { localStorage.removeItem(FAILS_KEY); } catch (_) { /* تجاهل */ }
  session = { userId: user.id, at: Date.now() };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) { /* تجاهل */ }
  return { ok: true, user };
}

/* ==========================================================================
   إدارة الحسابات (تُستدعى من صفحة المستخدمين الخاصة بمدير النظام)
   ========================================================================== */
const USERNAME_RE = /^[a-z0-9._-]{3,20}$/;
const adminCount = () => state.users.filter((u) => u.role === 'admin' && u.active).length;

function validateUser(data, { isNew }) {
  if ((data.name || '').trim().length < 3) return 'الاسم يجب ألا يقل عن 3 أحرف';
  if (!ROLES[data.role]) return 'الدور غير صحيح';
  if (isNew) {
    const username = (data.username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return 'اسم المستخدم: من 3 إلى 20 حرفاً إنجليزياً أو أرقاماً (يُسمح بـ . _ -)';
    if (state.users.some((u) => u.username === username)) return 'اسم المستخدم مستخدم مسبقاً';
    if ((data.password || '').length < 6) return 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  }
  if (data.phone && !/^[0-9+\s-]{7,15}$/.test(data.phone.trim())) return 'رقم الجوال غير صحيح';
  if (data.role === 'technician') {
    if (!(data.specialty || '').trim()) return 'أدخل تخصص الفني';
    if (!data.categories || !data.categories.length) return 'اختر تصنيفاً واحداً على الأقل لتخصص الفني';
  }
  return null;
}

function applyProfile(user, data) {
  user.name = data.name.trim();
  user.role = data.role;
  user.phone = (data.phone || '').trim();
  if (data.role === 'technician') {
    user.specialty = data.specialty.trim();
    user.categories = [...data.categories];
    user.title = (data.title || '').trim() || `فني ${user.specialty}`;
  } else {
    delete user.specialty;
    delete user.categories;
    user.title = (data.title || '').trim() || ROLES[data.role].label;
  }
}

function createUser(data) {
  const error = validateUser(data, { isNew: true });
  if (error) return { ok: false, error };
  const username = data.username.trim().toLowerCase();
  const user = {
    id: `u-${uid()}`,
    username,
    passHash: hashPassword(username, data.password),
    active: true,
    color: AVATAR_COLORS[state.users.length % AVATAR_COLORS.length],
    createdAt: new Date().toISOString(),
  };
  applyProfile(user, data);
  state.users.push(user);
  saveState();
  return { ok: true, user };
}

function updateUser(id, data) {
  const user = state.users.find((u) => u.id === id);
  if (!user) return { ok: false, error: 'الحساب غير موجود' };
  const error = validateUser(data, { isNew: false });
  if (error) return { ok: false, error };

  if (data.role !== user.role) {
    if (user.id === currentUser().id) return { ok: false, error: 'لا يمكنك تغيير دور حسابك الحالي' };
    if (user.role === 'technician' && workload(user.id) > 0) return { ok: false, error: 'لدى الفني مهام نشطة. أعد تعيينها قبل تغيير دوره' };
    if (user.role === 'admin' && adminCount() <= 1) return { ok: false, error: 'لا يمكن إزالة آخر مدير نظام' };
  }
  applyProfile(user, data);
  saveState();
  return { ok: true, user };
}

function setPassword(id, password) {
  const user = state.users.find((u) => u.id === id);
  if (!user) return { ok: false, error: 'الحساب غير موجود' };
  if ((password || '').length < 6) return { ok: false, error: 'كلمة المرور يجب ألا تقل عن 6 أحرف' };
  user.passHash = hashPassword(user.username, password);
  saveState();
  return { ok: true };
}

function changeOwnPassword(current, next) {
  const me = currentUser();
  if (me.passHash !== hashPassword(me.username, current)) return { ok: false, error: 'كلمة المرور الحالية غير صحيحة' };
  return setPassword(me.id, next);
}

function toggleActive(id) {
  const user = state.users.find((u) => u.id === id);
  if (!user) return { ok: false, error: 'الحساب غير موجود' };
  if (user.id === currentUser().id) return { ok: false, error: 'لا يمكنك إيقاف حسابك الحالي' };
  if (user.active && user.role === 'technician' && workload(user.id) > 0) {
    return { ok: false, error: 'لدى الفني مهام نشطة. أعد تعيينها أولاً ثم أوقف الحساب' };
  }
  if (user.active && user.role === 'admin' && adminCount() <= 1) return { ok: false, error: 'لا يمكن إيقاف آخر مدير نظام' };
  user.active = !user.active;
  saveState();
  return { ok: true, user };
}

function removeUser(id) {
  const user = state.users.find((u) => u.id === id);
  if (!user) return { ok: false, error: 'الحساب غير موجود' };
  if (user.id === currentUser().id) return { ok: false, error: 'لا يمكنك حذف حسابك الحالي' };
  if (state.tickets.some((t) => t.requesterId === id || t.assignedTo === id)) {
    return { ok: false, error: 'الحساب مرتبط ببلاغات، لا يمكن حذفه. يمكنك إيقافه بدلاً من ذلك' };
  }
  state.users = state.users.filter((u) => u.id !== id);
  if (state.checklists) delete state.checklists[id];
  saveState();
  return { ok: true };
}

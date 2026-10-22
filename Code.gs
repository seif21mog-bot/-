// جنة الياسمين - Backend (Google Apps Script). شغّل setup() مرة واحدة.
const TZ = 'Africa/Cairo';
const H = {
  Customers: ['ID', 'الاسم', 'الهاتف', 'ملاحظات', 'تاريخ الإنشاء', 'الحالة'],
  Suppliers: ['ID', 'الاسم', 'الهاتف', 'ملاحظات', 'تاريخ الإنشاء', 'الحالة'],
  Transactions: ['ID', 'التاريخ', 'نوع الحساب', 'رقم الحساب', 'اسم الحساب', 'نوع الحركة', 'المبلغ', 'الوصف', 'المستخدم', 'مرجع'],
  Settings: ['المفتاح', 'القيمة']
};
const sh = n => SpreadsheetApp.getActive().getSheetByName(n);
const r2 = n => Math.round(n * 100) / 100;
const now = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
const eff = (k, a) => k == 'PAYMENT' ? -a : a; // أثر الحركة على الرصيد
const clean = s => String(s || '').trim().slice(0, 300);
const rows = n => { const v = sh(n).getDataRange().getValues(); v.shift(); return v; };

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  for (const n in H) {
    const s = ss.getSheetByName(n) || ss.insertSheet(n);
    s.getRange(1, 1, s.getMaxRows(), H[n].length).setNumberFormat('@'); // نص فقط: يمنع تنفيذ الصيغ
    s.getRange(1, 1, 1, H[n].length).setValues([H[n]]).setFontWeight('bold');
    s.setFrozenRows(1); s.setRightToLeft(true);
  }
  sh('Transactions').getRange('G2:G').setNumberFormat('0.00');
  const st = sh('Settings');
  if (st.getLastRow() < 2) st.getRange(2, 1, 4, 2).setValues([['shopName', 'جنة الياسمين'], ['currency', 'EGP'], ['clientId', ''], ['allowedEmails', '']]);
}

function settings() { const o = {}; rows('Settings').forEach(r => o[r[0]] = String(r[1])); return o; }

// التحقق من حساب جوجل: توكن Google Sign-In + قائمة البريد المسموح
function auth(t) {
  if (!t) throw new Error('AUTH');
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(t), { muteHttpExceptions: true });
  if (r.getResponseCode() != 200) throw new Error('AUTH');
  const j = JSON.parse(r.getContentText()), s = settings();
  const ok = s.allowedEmails.toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (!s.clientId || j.aud !== s.clientId || String(j.email_verified) !== 'true' || !ok.includes(String(j.email).toLowerCase())) throw new Error('AUTH');
  return j.email;
}

function doGet() { return ContentService.createTextOutput('OK'); }

function doPost(e) {
  let out;
  try {
    const q = JSON.parse(e.postData.contents), user = auth(q.token);
    if (q.action == 'state') out = { ok: true, data: Object.assign(state(), { user: user, shop: settings().shopName }) };
    else {
      const L = LockService.getScriptLock(); L.waitLock(20000);
      try { out = { ok: true, data: write(q, user) }; SpreadsheetApp.flush(); } finally { L.releaseLock(); }
    }
  } catch (err) {
    const m = String(err.message || err);
    out = m == 'AUTH' ? { ok: false, code: 'AUTH', error: 'غير مصرح لك بالدخول' } : { ok: false, error: /[\u0600-\u06FF]/.test(m) ? m : 'حدث خطأ غير متوقع' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function state() {
  const T = rows('Transactions').map(r => ({ id: r[0], dt: String(r[1]), acct: r[3], name: r[4], kind: r[5], amt: Number(r[6]), desc: r[7], user: r[8], ref: r[9] }));
  const acc = n => rows(n).map(r => {
    const x = { id: r[0], name: r[1], phone: String(r[2]), notes: r[3], created: String(r[4]), debit: 0, paid: 0 };
    T.forEach(q => { if (q.acct == x.id) { if (q.kind == 'PAYMENT') x.paid += q.amt; else x.debit += q.amt; } });
    x.debit = r2(x.debit); x.paid = r2(x.paid); x.balance = r2(x.debit - x.paid);
    x.status = x.balance <= 0 ? 'مسدد بالكامل' : x.paid > 0 ? 'مسدد جزئيًا' : 'مدين';
    return x;
  });
  return { customers: acc('Customers'), suppliers: acc('Suppliers'), tx: T };
}

function syncStatus() {
  const d = state();
  [['Customers', d.customers], ['Suppliers', d.suppliers]].forEach(p => { if (p[1].length) sh(p[0]).getRange(2, 6, p[1].length, 1).setValues(p[1].map(a => [a.status])); });
}

function write(q, user) {
  const c = CacheService.getScriptCache(), rid = String(q.requestId || '');
  if (!rid) throw new Error('طلب غير صالح');
  const hit = c.get(rid); if (hit) return JSON.parse(hit); // طلب مكرر: أعد النتيجة السابقة بدون تنفيذ
  let res;
  if (q.action == 'addAccount') res = addAccount(q, user);
  else if (q.action == 'editAccount') res = editAccount(q);
  else if (q.action == 'tx') res = txOp(q, user);
  else if (q.action == 'reverse') res = reverse(q, user);
  else throw new Error('إجراء غير معروف');
  syncStatus(); c.put(rid, JSON.stringify(res), 21600);
  return res;
}

function num(v) { const a = Number(v); if (v === '' || v == null || !isFinite(a)) throw new Error('المبلغ غير صالح'); return r2(a); }

function findAcct(id) {
  const t = String(id)[0] == 'S' ? 'S' : 'C', s = sh(t == 'C' ? 'Customers' : 'Suppliers'), v = s.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (v[i][0] == id) return { id: id, name: v[i][1], t: t, s: s, row: i + 1 };
  throw new Error('الحساب غير موجود');
}

function bal(id) { let b = 0; rows('Transactions').forEach(r => { if (r[3] == id) b += eff(r[5], Number(r[6])); }); return r2(b); }

function addTx(a, kind, amt, desc, user, ref) {
  if (r2(bal(a.id) + eff(kind, amt)) < 0) throw new Error('المبلغ أكبر من الرصيد المتبقي (' + bal(a.id).toFixed(2) + ' جنيه)');
  const id = 'T-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  sh('Transactions').appendRow([id, now(), a.t == 'C' ? 'عميل' : 'مورد', a.id, a.name, kind, amt, desc, user, ref || '']);
  return id;
}

function addAccount(q, user) {
  const t = q.type == 'S' ? 'S' : 'C', name = clean(q.name);
  if (!name) throw new Error('الاسم مطلوب');
  const op = q.opening === '' || q.opening == null ? 0 : num(q.opening);
  if (op < 0) throw new Error('الرصيد الافتتاحي لا يمكن أن يكون سالبًا');
  const id = t + '-' + Utilities.getUuid().slice(0, 8);
  sh(t == 'C' ? 'Customers' : 'Suppliers').appendRow([id, name, clean(q.phone), clean(q.notes), now(), '']);
  if (op > 0) addTx({ id: id, name: name, t: t }, 'OPENING', op, 'رصيد افتتاحي', user);
  return { id: id };
}

function editAccount(q) {
  const a = findAcct(q.id), name = clean(q.name);
  if (!name) throw new Error('الاسم مطلوب');
  a.s.getRange(a.row, 2, 1, 3).setValues([[name, clean(q.phone), clean(q.notes)]]); // لا يغيّر الحركات السابقة
  return { id: a.id };
}

function txOp(q, user) {
  const kind = q.kind, a = findAcct(q.id), amt = num(q.amount), desc = clean(q.desc);
  if (['CHARGE', 'PAYMENT', 'ADJUSTMENT'].indexOf(kind) < 0) throw new Error('نوع الحركة غير صالح');
  if (kind != 'ADJUSTMENT' && amt <= 0) throw new Error('يجب أن يكون المبلغ أكبر من صفر');
  if (kind == 'ADJUSTMENT' && (amt == 0 || !desc)) throw new Error('التسوية تحتاج مبلغًا (موجب أو سالب) وسببًا');
  return { id: addTx(a, kind, amt, desc, user) };
}

function reverse(q, user) {
  const T = rows('Transactions'), o = T.find(r => r[0] == q.txId), reason = clean(q.reason);
  if (!o) throw new Error('الحركة غير موجودة');
  if (!reason) throw new Error('سبب العكس مطلوب');
  if (o[5] == 'REVERSAL' || T.some(r => r[5] == 'REVERSAL' && r[9] == o[0])) throw new Error('هذه الحركة معكوسة بالفعل أو لا يمكن عكسها');
  return { id: addTx(findAcct(o[3]), 'REVERSAL', -eff(o[5], Number(o[6])), 'عكس ' + o[0] + ': ' + reason, user, o[0]) };
}

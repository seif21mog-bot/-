const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Cairo' });
const D = { customers: [], suppliers: [], tx: [], user: '', shop: '' };
const S = { v: 'dash', q: '', debt: false, h: null, from: today(), to: today(), tq: '' };
let token = '';

async function api(action, data = {}, requestId) {
  let j;
  try {
    const r = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, requestId, ...data }) });
    j = await r.json();
  } catch (e) { throw new Error('تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى'); }
  if (!j.ok) { const e = new Error(j.error); e.code = j.code; throw e; }
  return j.data;
}
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = bad ? 'bad' : ''; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 3500); }
function showLogin(msg) { $('#app').hidden = true; $('#login').hidden = false; $('#lerr').textContent = msg || ''; }
async function load() {
  try { Object.assign(D, await api('state')); $('#login').hidden = true; $('#app').hidden = false; render(); }
  catch (e) { e.code == 'AUTH' ? showLogin(e.message) : toast(e.message, true); }
}
window.onload = () => {
  google.accounts.id.initialize({ client_id: CONFIG.CLIENT_ID, callback: r => { token = r.credential; load(); } });
  google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large' });
};

function ask(title, fields, fn) {
  const d = $('#dlg'), rid = crypto.randomUUID(); // نفس المعرف عند إعادة المحاولة = لا تكرار
  d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${fields.map(f => `<label>${esc(f.l)}${f.t == 'area' ? `<textarea name="${f.n}">${esc(f.v)}</textarea>` : `<input name="${f.n}" type="${f.t || 'text'}" value="${esc(f.v)}" ${f.r ? 'required' : ''} ${f.t == 'number' ? 'step="0.01"' : ''}>`}</label>`).join('')}<p class="err"></p><div class="row"><button class="pri">تأكيد</button><button type="button" id="cx">إلغاء</button></div></form>`;
  d.showModal();
  $('#cx').onclick = () => d.close();
  d.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const b = e.submitter; b.disabled = true;
    try { await fn(Object.fromEntries(new FormData(e.target)), rid); d.close(); toast('تم الحفظ بنجاح'); await load(); }
    catch (x) { d.querySelector('.err').textContent = x.message; b.disabled = false; }
  };
}

const kindLabel = (id, k) => ({ OPENING: 'رصيد افتتاحي', CHARGE: id[0] == 'C' ? 'مشتريات (دين جديد)' : 'فاتورة', PAYMENT: id[0] == 'C' ? 'دفعة مستلمة' : 'دفعة مدفوعة', ADJUSTMENT: 'تسوية', REVERSAL: 'عكس حركة' }[k] || k);
const tbl = (h, r) => `<div class="tw"><table><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr>${r}</table></div>`;
const badge = s => `<span class="b ${s == 'مدين' ? 'b1' : s == 'مسدد جزئيًا' ? 'b2' : 'b3'}">${s}</span>`;
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

function txRows(list, rev) {
  const done = new Set(D.tx.filter(t => t.kind == 'REVERSAL').map(t => t.ref));
  return list.map(t => `<tr><td>${esc(t.id)}</td><td>${esc(t.dt)}</td><td>${esc(t.name)}</td><td>${kindLabel(t.acct, t.kind)}</td><td>${fmt(t.amt)}</td><td>${esc(t.desc)}</td><td>${esc(t.ref)}</td><td>${rev && t.kind != 'REVERSAL' && !done.has(t.id) ? `<button data-a="rev" data-id="${esc(t.id)}">عكس</button>` : ''}</td></tr>`).join('');
}
const TH = ['رقم الحركة', 'التاريخ', 'الحساب', 'النوع', 'المبلغ', 'الوصف', 'مرجع', ''];

function dash() {
  const t = today(), c = D.customers, s = D.suppliers;
  const pay = p => sum(D.tx.filter(x => x.kind == 'PAYMENT' && x.acct[0] == p && x.dt.slice(0, 10) == t), x => x.amt);
  const card = (l, v) => `<div class="card"><small>${l}</small><b>${v}</b></div>`;
  return `<h2>لوحة التحكم</h2><div class="cards">
${card('إجمالي ديون العملاء للمحل (المسجلة)', fmt(sum(c, a => a.debit)))}
${card('إجمالي المبالغ المستحقة للمحل من العملاء (المتبقي)', fmt(sum(c, a => a.balance)))}
${card('إجمالي ديون المحل للموردين (المتبقي)', fmt(sum(s, a => a.balance)))}
${card('المدفوع اليوم', `مستلم من العملاء: ${fmt(pay('C'))}<br>مدفوع للموردين: ${fmt(pay('S'))}`)}
${card('عدد العملاء المدينين', c.filter(a => a.balance > 0).length)}
${card('موردون لم تُسوَّ حساباتهم', s.filter(a => a.balance > 0).length)}</div>`;
}

function accView(t) {
  const list = D[t == 'C' ? 'customers' : 'suppliers'].filter(a => (!S.debt || a.balance > 0) && (a.name + ' ' + a.phone).toLowerCase().includes(S.q.toLowerCase())).sort((a, b) => b.balance - a.balance);
  const cu = t == 'C', h = S.h && D.tx.length ? D.tx.filter(x => x.acct == S.h) : null;
  const rows = list.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.phone)}</td><td>${fmt(a.debit)}</td><td>${fmt(a.paid)}</td><td>${fmt(a.balance)}</td><td>${badge(a.status)}</td><td>
<button data-a="tx" data-k="CHARGE" data-id="${a.id}">${cu ? 'دين جديد' : 'فاتورة'}</button>
<button data-a="tx" data-k="PAYMENT" data-id="${a.id}">${cu ? 'دفعة مستلمة' : 'دفعة مدفوعة'}</button>
<button data-a="tx" data-k="ADJUSTMENT" data-id="${a.id}">تسوية</button>
<button data-a="hist" data-id="${a.id}">السجل</button><button data-a="edit" data-id="${a.id}">تعديل</button></td></tr>`).join('');
  return `<h2>${cu ? 'ديون العملاء' : 'ديون الموردين'}</h2><div class="tools"><input id="q" placeholder="بحث بالاسم أو الهاتف" value="${esc(S.q)}"><label><input type="checkbox" id="debt" ${S.debt ? 'checked' : ''} style="width:auto"> المدينون فقط</label><button class="pri" data-a="new" data-k="${t}">${cu ? 'إضافة عميل' : 'إضافة مورد'}</button></div>
${tbl(['الاسم', 'الهاتف', cu ? 'إجمالي الدين' : 'إجمالي الفواتير', 'إجمالي المدفوع', 'المتبقي', 'الحالة', 'إجراءات'], rows)}
${h ? `<h3>سجل الحساب <button data-a="hist" data-id="">إغلاق</button></h3>${tbl(TH, txRows(h.slice().reverse(), true))}` : ''}`;
}

function txView() {
  const q = S.tq.toLowerCase();
  const l = D.tx.filter(t => (!q || (t.id + t.name + t.desc).toLowerCase().includes(q)) && t.dt.slice(0, 10) >= S.from && t.dt.slice(0, 10) <= S.to).reverse();
  return `<h2>سجل الحركات</h2>${dates()}<div class="tools"><input id="tq" placeholder="بحث باسم الحساب أو رقم الحركة" value="${esc(S.tq)}"></div>${tbl(TH, txRows(l, true))}`;
}
const dates = () => `<div class="tools">من <input type="date" id="from" value="${S.from}" style="width:auto"> إلى <input type="date" id="to" value="${S.to}" style="width:auto"></div>`;

function repView() {
  const inR = k => D.tx.filter(t => t.kind == 'PAYMENT' && t.acct[0] == k && t.dt.slice(0, 10) >= S.from && t.dt.slice(0, 10) <= S.to);
  const dr = l => tbl(['الاسم', 'الهاتف', 'المتبقي'], l.filter(a => a.balance > 0).sort((a, b) => b.balance - a.balance).map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.phone)}</td><td>${fmt(a.balance)}</td></tr>`).join(''));
  const r = inR('C'), p = inR('S'), all = D.tx.filter(t => t.dt.slice(0, 10) >= S.from && t.dt.slice(0, 10) <= S.to).reverse();
  return `<h2>التقارير</h2>${dates()}<div class="tools"><button class="pri" data-a="print">طباعة</button></div>
<h3>تقرير ديون العملاء (مرتب من الأعلى)</h3>${dr(D.customers)}
<h3>تقرير ديون الموردين (مرتب من الأعلى)</h3>${dr(D.suppliers)}
<h3>دفعات مستلمة من العملاء — الإجمالي ${fmt(sum(r, x => x.amt))}</h3>${tbl(TH, txRows(r))}
<h3>دفعات مدفوعة للموردين — الإجمالي ${fmt(sum(p, x => x.amt))}</h3>${tbl(TH, txRows(p))}
<h3>كل الحركات في الفترة</h3>${tbl(TH, txRows(all))}`;
}

function setView() {
  return `<h2>الإعدادات</h2><div class="card"><p>المحل: ${esc(D.shop)}</p><p>المستخدم الحالي: ${esc(D.user)}</p><p>العملة: جنيه مصري (EGP) — المنطقة الزمنية: Africa/Cairo</p><p>لإضافة مستخدمين مسموح لهم عدّل صف allowedEmails في ورقة Settings (بريدات مفصولة بفاصلة).</p><button data-a="out">تسجيل الخروج</button></div>`;
}

function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v == S.v));
  const v = { dash, C: () => accView('C'), S: () => accView('S'), tx: txView, rep: repView, set: setView }[S.v];
  $('#main').innerHTML = v();
  const keep = id => { const e = $(id); if (e && e === document.activeElement) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } };
  keep('#q'); keep('#tq');
}

$('#nav').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { S.v = b.dataset.v; S.h = null; S.q = ''; render(); } };
$('#main').oninput = e => {
  const i = e.target;
  if (i.id == 'q') S.q = i.value; else if (i.id == 'tq') S.tq = i.value;
  else if (i.id == 'debt') S.debt = i.checked; else if (i.id == 'from') S.from = i.value; else if (i.id == 'to') S.to = i.value; else return;
  const pos = i.selectionStart; render(); const n = $('#' + i.id); if (n && n.type == 'text') { n.focus(); n.setSelectionRange(pos, pos); }
};
$('#main').onclick = e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const { a, id, k } = b.dataset, acc = [...D.customers, ...D.suppliers].find(x => x.id == id);
  if (a == 'print') window.print();
  else if (a == 'out') { token = ''; google.accounts.id.disableAutoSelect(); showLogin(); }
  else if (a == 'hist') { S.h = id || null; render(); }
  else if (a == 'new') ask(k == 'C' ? 'إضافة عميل' : 'إضافة مورد', [{ n: 'name', l: 'الاسم الكامل', r: 1 }, { n: 'phone', l: 'الهاتف (اختياري)' }, { n: 'opening', l: k == 'C' ? 'الدين الافتتاحي (جنيه)' : 'المبلغ المستحق للمورد افتتاحيًا (جنيه)', t: 'number', v: '0' }, { n: 'notes', l: 'ملاحظات', t: 'area' }], (f, rid) => api('addAccount', { type: k, ...f }, rid));
  else if (a == 'edit') ask('تعديل بيانات ' + acc.name, [{ n: 'name', l: 'الاسم', v: acc.name, r: 1 }, { n: 'phone', l: 'الهاتف', v: acc.phone }, { n: 'notes', l: 'ملاحظات', v: acc.notes, t: 'area' }], (f, rid) => api('editAccount', { id, ...f }, rid));
  else if (a == 'tx') {
    const t = { CHARGE: id[0] == 'C' ? 'تسجيل دين جديد' : 'تسجيل فاتورة', PAYMENT: id[0] == 'C' ? 'تسجيل دفعة مستلمة' : 'تسجيل دفعة مدفوعة', ADJUSTMENT: 'تسوية (موجب يزيد الرصيد، سالب ينقصه)' }[k];
    ask(`${t} — ${acc.name} (المتبقي ${fmt(acc.balance)})`, [{ n: 'amount', l: 'المبلغ (جنيه)', t: 'number', r: 1 }, { n: 'desc', l: k == 'ADJUSTMENT' ? 'السبب (مطلوب)' : 'وصف (اختياري)' }], (f, rid) => api('tx', { kind: k, id, amount: f.amount, desc: f.desc }, rid));
  } else if (a == 'rev') ask('عكس الحركة ' + id, [{ n: 'reason', l: 'سبب العكس (مطلوب)', r: 1 }], (f, rid) => api('reverse', { txId: id, reason: f.reason }, rid));
};

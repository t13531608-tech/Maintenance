/* ==========================================================================
   app.js — منطق نظام إدارة طلبات الصيانة (CMMS)
   يعتمد على data.js (الثوابت + البيانات التجريبية)
   ========================================================================== */
'use strict';

/* ==========================================================================
   1) الحالة والتخزين
   ========================================================================== */
let state = loadState();

// حالة الواجهة (لا تُحفظ)
const ui = {
  view: 'dashboard',
  search: '',
  status: 'all',
  priority: 'all',
  ticketId: null,
  weekOffset: 0,
  day: localDateKey(new Date()),
  notifOpen: false,
  newImage: null,
  userRole: 'all',
  kpi: {},
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tickets) && Array.isArray(parsed.users)) return parsed;
    }
  } catch (err) {
    console.warn('تعذر قراءة البيانات المحفوظة، سيتم استخدام البيانات التجريبية.', err);
  }
  const fresh = buildSeedState();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); } catch (_) { /* تجاهل */ }
  return fresh;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast('تعذر الحفظ: مساحة التخزين ممتلئة', 'error');
  }
}

/* ==========================================================================
   2) أدوات مساعدة
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const norm = (s) => String(s ?? '').toLowerCase().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DAY_LETTERS = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج']; // الأسبوع يبدأ السبت

function fmtDateTime(iso) {
  return new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
function fmtDate(iso) {
  return new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }).format(new Date(iso));
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${localDateKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function timeAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs === 1 ? 'منذ ساعة' : `منذ ${hrs} ساعة`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'منذ يوم' : `منذ ${days} يوم`;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ==========================================================================
   3) الوصول إلى البيانات
   ========================================================================== */
const getTicket = (id) => state.tickets.find((t) => t.id === id);
const userById = (id) => state.users.find((u) => u.id === id);
const techById = userById; // الفني المعيّن للبلاغ (قد يكون موقوفاً لاحقاً)
const technicians = () => state.users.filter((u) => u.role === 'technician' && u.active);
const workload = (techId) => state.tickets.filter((t) => t.assignedTo === techId && ACTIVE_STATUSES.includes(t.status)).length;

/** المستخدم المسجّل دخوله (لا يُستدعى إلا بعد التحقق من الجلسة) */
const currentUser = () => sessionUser();
const isAdmin = () => currentUser().role === 'admin';
/** الدور الفعلي لمنطق الواجهة: مدير النظام يملك كل صلاحيات مسؤول الصيانة */
const currentRole = () => (isAdmin() ? 'manager' : currentUser().role);

/** قائمة المهام السريعة الخاصة بالمستخدم الحالي */
function myList() {
  if (!state.checklists) state.checklists = {};
  const id = currentUser().id;
  if (!state.checklists[id]) state.checklists[id] = [];
  return state.checklists[id];
}

/** البلاغات المرئية للمستخدم الحالي حسب دوره */
function visibleTickets() {
  const me = currentUser();
  if (me.role === 'employee') return state.tickets.filter((t) => t.requesterId === me.id);
  if (me.role === 'technician') return state.tickets.filter((t) => t.assignedTo === me.id);
  return state.tickets;
}

function isBreached(t) {
  if (!t.slaDeadline) return false;
  const end = t.status === 'fixed' ? new Date(t.fixedAt || Date.now()) : new Date();
  return end > new Date(t.slaDeadline);
}

function sortTickets(list) {
  return [...list].sort((a, b) =>
    (a.status === 'fixed') - (b.status === 'fixed') ||
    PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank ||
    new Date(b.createdAt) - new Date(a.createdAt));
}

function filterTickets(base, { useFilters = false } = {}) {
  const q = norm(ui.search);
  return sortTickets(base.filter((t) => {
    if (q && ![t.id, t.title, t.location].some((v) => norm(v).includes(q))) return false;
    if (useFilters) {
      if (ui.status !== 'all' && t.status !== ui.status) return false;
      if (ui.priority !== 'all' && t.priority !== ui.priority) return false;
    }
    return true;
  }));
}

function slaStats() {
  const withSla = state.tickets.filter((t) => t.slaDeadline);
  const breached = withSla.filter(isBreached).length;
  const ok = withSla.length - breached;
  const pct = withSla.length ? Math.round((ok / withSla.length) * 100) : 100;
  return { total: withSla.length, ok, breached, pct };
}

function monthlySeries() {
  const now = new Date();
  const out = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    let total; let closed;
    if (i === 0) {
      const inMonth = state.tickets.filter((t) => {
        const c = new Date(t.createdAt);
        return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth();
      });
      total = inMonth.length;
      closed = inMonth.filter((t) => t.status === 'fixed').length;
    } else {
      ({ total, closed } = MONTH_BASELINE[5 - i]);
    }
    out.push({ label: MONTHS[d.getMonth()], total, closed });
  }
  return out;
}

/* ---------- تعديل البيانات ---------- */
function logEvent(ticket, text, by = currentUser().name) {
  ticket.timeline.push({ id: uid(), kind: 'event', at: new Date().toISOString(), by, text });
}

function notify(text, ticketId, target = {}) {
  state.notifications.unshift({ id: uid(), text, ticketId, at: new Date().toISOString(), read: false, roles: ['manager'], ...target });
  state.notifications = state.notifications.slice(0, 30);
}

function visibleNotifications() {
  return state.notifications.filter((n) => {
    if (!n.roles.includes(currentRole())) return false;
    if (currentRole() === 'technician' && n.techId && n.techId !== currentUser().id) return false;
    if (currentRole() === 'employee' && n.requesterId && n.requesterId !== currentUser().id) return false;
    return true;
  });
}

function defaultSla(priority) {
  return new Date(Date.now() + PRIORITIES[priority].slaHours * 3600e3).toISOString();
}

/* ==========================================================================
   4) التصيير (Rendering)
   ========================================================================== */
function render() {
  if (!sessionUser()) return;
  if (!navItems().some((i) => i.id === ui.view)) ui.view = 'dashboard';
  renderSidebar();
  renderGreeting();
  renderView();
  renderPanel();
  renderNotifications();
  if (ui.ticketId) renderDrawer();
  refreshIcons();
}

/* ---------- الشريط الجانبي ---------- */
function navItems() {
  const ticketsLabel = { employee: 'بلاغاتي', technician: 'مهامي', manager: 'جميع البلاغات' }[currentRole()];
  return [
    { id: 'dashboard', label: 'لوحة التحكم', icon: 'layout-dashboard' },
    { id: 'tickets', label: ticketsLabel, icon: 'clipboard-list' },
    ...(currentRole() === 'manager' ? [{ id: 'technicians', label: 'الفنيون', icon: 'users' }] : []),
    ...(isAdmin() ? [{ id: 'users', label: 'المستخدمون', icon: 'user-cog' }] : []),
    { id: 'settings', label: 'الإعدادات', icon: 'settings' },
  ];
}

function renderSidebar() {
  const urgent = visibleTickets().filter((t) => t.priority === 'urgent' && t.status !== 'fixed').length;
  const nav = navItems().map((i) => `
    <button class="nav-item ${ui.view === i.id ? 'active' : ''}" data-action="nav" data-view="${i.id}">
      <i data-lucide="${i.icon}" class="h-5 w-5"></i>
      <span class="flex-1 text-start">${i.label}</span>
      ${i.id === 'tickets' && urgent ? `<span class="badge-urgent" title="بلاغات عاجلة مفتوحة">${urgent}</span>` : ''}
    </button>`).join('');

  const newButton = currentRole() === 'technician' ? '' : `
    <div class="mt-auto rounded-3xl bg-[#E4E2FC] p-4">
      <p class="text-sm font-extrabold">لديك عطل؟</p>
      <p class="mt-1 text-xs leading-5 text-gray-600">ارفع بلاغاً جديداً وسيصل فوراً إلى فريق الصيانة.</p>
      <button class="btn btn-dark mt-3 w-full" data-action="openNew">
        <i data-lucide="plus" class="h-4 w-4"></i> رفع بلاغ جديد
      </button>
    </div>`;

  $('#sidebar').innerHTML = `
    <div class="mb-7 flex items-center gap-3 px-1">
      <div class="grid h-11 w-11 place-items-center rounded-2xl bg-gray-900 text-white"><i data-lucide="wrench" class="h-5 w-5"></i></div>
      <div class="leading-tight">
        <p class="text-lg font-extrabold">صيانة<span class="text-indigo-500">+</span></p>
        <p class="text-[11px] text-gray-400">نظام إدارة الصيانة CMMS</p>
      </div>
    </div>
    <nav class="space-y-1.5">${nav}</nav>
    ${newButton}
    <button class="nav-item logout ${newButton ? 'mt-3' : 'mt-auto'}" data-action="logout"><i data-lucide="log-out" class="h-5 w-5"></i><span>تسجيل الخروج</span></button>`;
}

function renderGreeting() {
  const user = currentUser();
  const today = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  $('#greeting').textContent = `مرحباً، ${user.name} 👋`;
  $('#subGreeting').textContent = `${user.title} · ${today}`;
}

/* ---------- العرض الرئيسي ---------- */
function renderView() {
  const views = { dashboard: dashboardView, tickets: ticketsView, technicians: techniciansView, settings: settingsView, users: usersView };
  $('#view').innerHTML = `<div class="fade-in">${views[ui.view]()}</div>`;
  refreshIcons();
  if (ui.view === 'dashboard') animateKpis();
}

/* ---------- لوحة التحكم ---------- */
function dashboardView() {
  const mine = visibleTickets();
  const scope = { employee: 'بلاغاتي', technician: 'مهامي', manager: 'كل المنشأة' }[currentRole()];
  const kpis = [
    { key: 'total', label: 'إجمالي البلاغات', value: mine.length, bg: '#E4E2FC', icon: 'clipboard-list' },
    { key: 'progress', label: 'قيد الإصلاح', value: mine.filter((t) => ACTIVE_STATUSES.includes(t.status)).length, bg: '#D9EEFF', icon: 'wrench' },
    { key: 'closed', label: 'تم الإغلاق', value: mine.filter((t) => t.status === 'fixed').length, bg: '#FCE4F6', icon: 'circle-check' },
  ];

  const kpiHtml = kpis.map((k) => `
    <div class="rounded-3xl p-5 shadow-sm" style="background:${k.bg}">
      <div class="flex items-center gap-3">
        <span class="grid h-10 w-10 place-items-center rounded-full bg-white/80"><i data-lucide="${k.icon}" class="h-5 w-5"></i></span>
        <span class="text-sm font-bold text-gray-700">${k.label}</span>
      </div>
      <p class="mt-4 text-4xl font-extrabold" data-kpi="${k.key}" data-value="${k.value}">${k.value}</p>
      <p class="mt-1 text-xs text-gray-500">${scope}</p>
    </div>`).join('');

  const feed = filterTickets(mine.filter((t) => t.status !== 'fixed')).slice(0, 5);

  return `
    <section class="grid grid-cols-1 gap-4 sm:grid-cols-3">${kpiHtml}</section>

    <section class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div class="card p-5 lg:col-span-3">${volumeChart()}</div>
      <div class="card p-5 lg:col-span-2">${slaGauge()}</div>
    </section>

    <section class="card mt-4 p-5">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-extrabold">البلاغات النشطة</h3>
        <button class="text-sm font-bold text-indigo-600 hover:underline" data-action="nav" data-view="tickets">عرض الكل</button>
      </div>
      <div class="space-y-3">${feed.length ? feed.map(ticketCard).join('') : emptyState('لا توجد بلاغات نشطة مطابقة')}</div>
    </section>`;
}

function volumeChart() {
  const series = monthlySeries();
  const max = Math.max(...series.map((s) => s.total), 1);
  const top = Math.ceil(max / 10) * 10;
  const H = 180;
  const ticks = [top, top * 0.75, top * 0.5, top * 0.25, 0].map((v) => Math.round(v));

  const cols = series.map((s) => {
    const h = Math.max(6, Math.round((s.total / top) * H));
    const closedH = s.total ? Math.round((s.closed / s.total) * h) : 0;
    return `
      <div class="bar-col" title="${s.label}: ${s.total} بلاغ (${s.closed} مغلق)">
        <div class="bar" style="height:${h}px"><i style="height:${closedH}px"></i></div>
        <span class="text-[11px] font-semibold text-gray-400">${s.label}</span>
      </div>`;
  }).join('');

  return `
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-extrabold">حجم الصيانة الشهري</h3>
      <div class="flex items-center gap-3 text-[11px] font-semibold text-gray-500">
        <span class="flex items-center gap-1"><i class="h-2.5 w-2.5 rounded-full bg-indigo-500"></i> مغلق</span>
        <span class="flex items-center gap-1"><i class="h-2.5 w-2.5 rounded-full bg-indigo-200"></i> الإجمالي</span>
      </div>
    </div>
    <div class="flex gap-3">
      <div class="flex flex-col justify-between pb-6 text-[11px] text-gray-400" style="height:${H + 24}px">${ticks.map((v) => `<span>${v}</span>`).join('')}</div>
      <div class="relative flex-1" style="height:${H + 24}px">
        <div class="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style="height:${H}px">
          ${ticks.map(() => '<div class="border-t border-dashed border-gray-100"></div>').join('')}
        </div>
        <div class="relative grid h-full grid-cols-6 items-end gap-2">${cols}</div>
      </div>
    </div>`;
}

function slaGauge() {
  const s = slaStats();
  const LEN = Math.PI * 80;
  const color = s.pct >= 85 ? '#10B981' : s.pct >= 70 ? '#F59E0B' : '#EF4444';
  return `
    <h3 class="text-lg font-extrabold">كفاءة الالتزام بـ SLA</h3>
    <div class="relative mx-auto mt-3 w-full max-w-[260px]">
      <svg viewBox="0 0 200 115" class="w-full">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#EEF0F4" stroke-width="16" stroke-linecap="round"/>
        <path class="gauge-arc" d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"
              stroke-dasharray="${(s.pct / 100) * LEN} ${LEN}"/>
      </svg>
      <div class="absolute inset-x-0 bottom-1 text-center">
        <p class="text-3xl font-extrabold" style="color:${color}">${s.pct}%</p>
      </div>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-3 text-center text-xs">
      <div class="rounded-2xl bg-emerald-50 p-2.5"><p class="text-lg font-extrabold text-emerald-600">${s.ok}</p><p class="text-gray-500">ضمن الموعد</p></div>
      <div class="rounded-2xl bg-red-50 p-2.5"><p class="text-lg font-extrabold text-red-500">${s.breached}</p><p class="text-gray-500">متأخرة</p></div>
    </div>`;
}

/* ---------- بطاقة البلاغ ---------- */
function ticketCard(t) {
  const cat = CATEGORIES[t.category];
  const pr = PRIORITIES[t.priority];
  const st = STATUSES[t.status];
  const tech = techById(t.assignedTo);
  const late = isBreached(t);

  return `
    <article class="ticket-card" data-action="openTicket" data-id="${t.id}" tabindex="0">
      <div class="flex min-w-0 items-center gap-3 md:w-[36%]">
        <div class="icon-tile ${cat.tile}"><i data-lucide="${cat.icon}" class="h-5 w-5"></i></div>
        <div class="min-w-0">
          <h4 class="truncate text-sm font-bold">${esc(t.title)}</h4>
          <p class="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-400"><i data-lucide="map-pin" class="h-3 w-3 shrink-0"></i>${esc(t.id)} · ${esc(t.location)}</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 md:w-[17%]">
        <span class="pill ring-1 ring-inset ${pr.badge}">${pr.label}</span>
        ${late ? '<span class="pill bg-red-50 text-red-600">متأخر</span>' : ''}
      </div>

      <div class="flex items-center gap-2 md:w-[20%]">
        ${tech
          ? `${avatar(tech, 'h-8 w-8 text-xs')}<div class="min-w-0"><p class="truncate text-xs font-bold">${esc(tech.name)}</p><p class="truncate text-[11px] text-gray-400">${esc(tech.specialty)}</p></div>`
          : '<span class="pill bg-gray-100 text-gray-500"><i data-lucide="user-x" class="h-3 w-3"></i> بدون فني</span>'}
      </div>

      <div class="md:flex-1">
        <div class="mb-1 flex items-center justify-between text-[11px] font-bold">
          <span class="text-gray-500">${st.label}</span><span>${st.progress}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${st.progress}%;background:${st.bar}"></div></div>
      </div>
    </article>`;
}

function avatar(tech, size = 'h-9 w-9 text-sm') {
  return `<span class="grid ${size} shrink-0 place-items-center rounded-full font-extrabold text-white" style="background:${tech.color}">${esc(tech.name.trim()[0])}</span>`;
}

function emptyState(text) {
  return `<div class="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
    <i data-lucide="inbox" class="mx-auto mb-2 h-8 w-8"></i>${text}</div>`;
}

/* ---------- صفحة البلاغات ---------- */
function ticketsView() {
  const base = visibleTickets();
  const list = filterTickets(base, { useFilters: true });
  const opt = (map, current) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${current === k ? 'selected' : ''}>${v.label}</option>`).join('');

  return `
    <section class="card p-5">
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <h3 class="ml-auto text-lg font-extrabold">${navItems().find((i) => i.id === 'tickets').label}</h3>
        <select class="field !w-auto" data-filter="status" aria-label="تصفية بالحالة">
          <option value="all">كل الحالات</option>${opt(STATUSES, ui.status)}
        </select>
        <select class="field !w-auto" data-filter="priority" aria-label="تصفية بالأولوية">
          <option value="all">كل الأولويات</option>${opt(PRIORITIES, ui.priority)}
        </select>
      </div>
      <p class="mb-3 text-xs text-gray-400">عرض ${list.length} من ${base.length} بلاغ</p>
      <div class="space-y-3">${list.length ? list.map(ticketCard).join('') : emptyState('لا توجد بلاغات مطابقة')}</div>
    </section>`;
}

/* ---------- صفحة الفنيين ---------- */
function techniciansView() {
  const cards = technicians().map((tc) => {
    const w = workload(tc.id);
    const pct = Math.min(100, Math.round((w / CAPACITY_PER_TECH) * 100));
    const barColor = pct >= 80 ? '#EF4444' : pct >= 50 ? '#F59E0B' : '#10B981';
    const active = state.tickets.filter((t) => t.assignedTo === tc.id && ACTIVE_STATUSES.includes(t.status));
    return `
      <div class="card p-5">
        <div class="flex items-center gap-3">
          ${avatar(tc, 'h-12 w-12 text-lg')}
          <div class="min-w-0 flex-1">
            <p class="font-extrabold">${esc(tc.name)}</p>
            <p class="text-xs text-gray-500">${esc(tc.specialty)}</p>
          </div>
          <span class="pill ${w ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-600'}">${w ? 'مشغول' : 'متاح'}</span>
        </div>
        <div class="mt-4">
          <div class="mb-1 flex justify-between text-xs font-bold"><span class="text-gray-500">المهام النشطة</span><span>${w} / ${CAPACITY_PER_TECH}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${barColor}"></div></div>
        </div>
        <p class="mt-3 flex items-center gap-1 text-xs text-gray-400" dir="ltr"><i data-lucide="phone" class="h-3 w-3"></i>${esc(tc.phone)}</p>
        <div class="mt-3 space-y-2">
          ${active.map((t) => `
            <button class="flex w-full items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-start text-xs transition hover:bg-gray-100" data-action="openTicket" data-id="${t.id}">
              <span class="font-bold text-gray-400">${t.id}</span><span class="flex-1 truncate font-semibold">${esc(t.title)}</span>
            </button>`).join('') || '<p class="text-xs text-gray-400">لا توجد مهام حالياً</p>'}
        </div>
      </div>`;
  }).join('');
  return `<section class="grid grid-cols-1 gap-4 md:grid-cols-2">${cards}</section>`;
}

/* ---------- صفحة المستخدمين (مدير النظام فقط) ---------- */
function usersView() {
  if (!isAdmin()) return emptyState('هذه الصفحة متاحة لمدير النظام فقط');
  const q = norm(ui.search);
  const me = currentUser();
  const count = (r) => state.users.filter((u) => r === 'all' || u.role === r).length;
  const list = state.users.filter((u) =>
    (ui.userRole === 'all' || u.role === ui.userRole) &&
    (!q || [u.name, u.username, u.title].some((v) => norm(v).includes(q))));

  const chips = [['all', 'الكل'], ...Object.entries(ROLES).map(([k, v]) => [k, v.label])].map(([k, label]) => `
    <button class="seg-btn !px-3 ${ui.userRole === k ? 'active' : ''}" data-action="userRole" data-role="${k}">${label} <span class="opacity-60">${count(k)}</span></button>`).join('');

  const rows = list.map((u) => {
    const self = u.id === me.id;
    return `
      <tr class="border-t border-gray-100 ${u.active ? '' : 'opacity-60'}">
        <td class="py-3 pl-3">
          <div class="flex items-center gap-3">
            ${avatar(u)}
            <div class="min-w-0">
              <p class="flex items-center gap-2 text-sm font-bold">${esc(u.name)}${self ? '<span class="pill bg-gray-100 text-gray-500">أنت</span>' : ''}</p>
              <p class="text-xs text-gray-400"><span dir="ltr">@${esc(u.username)}</span></p>
            </div>
          </div>
        </td>
        <td class="px-3"><span class="pill ${ROLES[u.role].badge}">${ROLES[u.role].label}</span></td>
        <td class="px-3 text-sm text-gray-600">${esc(u.title || '—')}${u.role === 'technician' ? ` <span class="text-xs text-gray-400">(${workload(u.id)} نشطة)</span>` : ''}</td>
        <td class="px-3"><span class="pill ${u.active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}">${u.active ? 'نشط' : 'موقوف'}</span></td>
        <td class="pr-3">
          <div class="flex justify-end gap-1.5">
            <button class="icon-btn" title="تعديل" data-action="editUser" data-id="${u.id}"><i data-lucide="pencil" class="h-4 w-4"></i></button>
            <button class="icon-btn" title="تعيين كلمة مرور جديدة" data-action="resetPass" data-id="${u.id}"><i data-lucide="key-round" class="h-4 w-4"></i></button>
            <button class="icon-btn" title="${u.active ? 'إيقاف الحساب' : 'تفعيل الحساب'}" data-action="toggleUser" data-id="${u.id}" ${self ? 'disabled' : ''}><i data-lucide="${u.active ? 'user-x' : 'user-check'}" class="h-4 w-4"></i></button>
            <button class="icon-btn danger" title="حذف" data-action="deleteUser" data-id="${u.id}" ${self ? 'disabled' : ''}><i data-lucide="trash-2" class="h-4 w-4"></i></button>
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <section class="card p-5">
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <div class="ml-auto">
          <h3 class="text-lg font-extrabold">إدارة المستخدمين</h3>
          <p class="text-xs text-gray-400">إنشاء حسابات الموظفين والفنيين والتحكم بصلاحياتهم</p>
        </div>
        <button class="btn btn-dark" data-action="openUser"><i data-lucide="user-plus" class="h-4 w-4"></i> إضافة حساب</button>
      </div>
      <div class="mb-4 flex flex-wrap gap-2">${chips}</div>
      <div class="overflow-x-auto">
        <table class="tbl w-full min-w-[640px] text-start">
          <thead><tr>
            <th>الحساب</th><th>الدور</th><th>الصفة / القسم</th><th>الحالة</th><th class="text-end">الإجراءات</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="5">${emptyState('لا توجد حسابات مطابقة')}</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

/* ---------- صفحة الإعدادات ---------- */
function settingsView() {
  const user = currentUser();
  const admin = isAdmin();
  return `
    <section class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div class="card p-5">
        <h3 class="mb-4 text-lg font-extrabold">الحساب الحالي</h3>
        <dl class="space-y-3 text-sm">
          <div class="flex justify-between"><dt class="text-gray-500">الاسم</dt><dd class="font-bold">${esc(user.name)}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">اسم المستخدم</dt><dd class="font-bold" dir="ltr">@${esc(user.username)}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">الصفة</dt><dd class="font-bold">${esc(user.title || '—')}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">الدور</dt><dd><span class="pill ${ROLES[user.role].badge}">${ROLES[user.role].label}</span></dd></div>
        </dl>
        <button class="btn btn-soft mt-5" data-action="clearNotifs"><i data-lucide="bell-off" class="h-4 w-4"></i> مسح الإشعارات</button>
      </div>

      <div class="card p-5">
        <h3 class="mb-4 text-lg font-extrabold">تغيير كلمة المرور</h3>
        <form id="changePassForm" class="space-y-3" autocomplete="off">
          <div><label class="label" for="cp-cur">كلمة المرور الحالية</label><input id="cp-cur" name="current" type="password" class="field" required autocomplete="current-password"></div>
          <div><label class="label" for="cp-new">كلمة المرور الجديدة</label><input id="cp-new" name="next" type="password" class="field" required minlength="6" autocomplete="new-password"></div>
          <div><label class="label" for="cp-rep">تأكيد كلمة المرور الجديدة</label><input id="cp-rep" name="repeat" type="password" class="field" required minlength="6" autocomplete="new-password"></div>
          <button class="btn btn-dark w-full"><i data-lucide="key-round" class="h-4 w-4"></i> تحديث كلمة المرور</button>
        </form>
      </div>

      ${admin ? `
      <div class="card p-5 md:col-span-2">
        <h3 class="mb-2 text-lg font-extrabold">البيانات</h3>
        <p class="mb-4 text-sm leading-7 text-gray-500">تُحفظ الحسابات والبلاغات والإشعارات في متصفحك عبر <span class="font-bold" dir="ltr">localStorage</span>. يوجد حالياً ${state.tickets.length} بلاغ و${state.users.length} حساب.</p>
        <button class="btn btn-danger" data-action="resetDemo"><i data-lucide="rotate-ccw" class="h-4 w-4"></i> إعادة تعيين البيانات التجريبية</button>
      </div>` : ''}
    </section>`;
}

/* ---------- نافذة إضافة / تعديل حساب ---------- */
function openUserModal(id = null) {
  const u = id ? userById(id) : null;
  const isNew = !u;
  const role = u ? u.role : 'employee';
  const self = u && u.id === currentUser().id;

  const roleOptions = Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${role === k ? 'selected' : ''}>${v.label}</option>`).join('');
  const cats = Object.entries(CATEGORIES).map(([k, v]) => `
    <label class="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm">
      <input type="checkbox" name="categories" value="${k}" ${u && u.categories && u.categories.includes(k) ? 'checked' : ''}> ${v.label}
    </label>`).join('');

  $('#modalBody').innerHTML = `
    <form id="userForm" data-id="${u ? u.id : ''}" class="p-6" autocomplete="off">
      <div class="mb-5 flex items-center justify-between">
        <h2 class="text-xl font-extrabold">${isNew ? 'إضافة حساب جديد' : 'تعديل الحساب'}</h2>
        <button type="button" class="btn btn-soft !p-2.5" data-action="closeModal" aria-label="إغلاق"><i data-lucide="x" class="h-5 w-5"></i></button>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label class="label" for="u-name">الاسم الكامل *</label>
          <input id="u-name" name="name" class="field" required maxlength="60" value="${u ? esc(u.name) : ''}" placeholder="مثال: محمد العتيبي">
        </div>

        <div>
          <label class="label" for="u-username">اسم المستخدم *</label>
          <input id="u-username" name="username" class="field" ${isNew ? 'required' : 'disabled'} maxlength="20" autocapitalize="none" spellcheck="false" value="${u ? esc(u.username) : ''}" placeholder="mohammed">
        </div>

        <div>
          <label class="label" for="u-role">الدور *</label>
          <select id="u-role" name="role" class="field" ${self ? 'disabled' : ''}>${roleOptions}</select>
        </div>

        ${isNew ? `
        <div class="sm:col-span-2">
          <label class="label" for="u-pass">كلمة المرور *</label>
          <div class="flex gap-2">
            <input id="u-pass" name="password" type="text" class="field" required minlength="6" autocomplete="new-password" placeholder="6 أحرف على الأقل">
            <button type="button" class="btn btn-soft shrink-0" data-action="genPass"><i data-lucide="wand-sparkles" class="h-4 w-4"></i> توليد</button>
          </div>
        </div>` : ''}

        <div>
          <label class="label" for="u-title">الصفة / القسم</label>
          <input id="u-title" name="title" class="field" maxlength="60" value="${u ? esc(u.title || '') : ''}" placeholder="مثال: موظف — المالية">
        </div>
        <div>
          <label class="label" for="u-phone">الجوال</label>
          <input id="u-phone" name="phone" class="field" maxlength="15" value="${u ? esc(u.phone || '') : ''}" placeholder="05xxxxxxxx">
        </div>

        <div id="techFields" class="${role === 'technician' ? '' : 'hidden'} space-y-3 rounded-2xl bg-gray-50 p-4 sm:col-span-2">
          <div>
            <label class="label" for="u-spec">تخصص الفني *</label>
            <input id="u-spec" name="specialty" class="field !bg-white" maxlength="40" value="${u && u.specialty ? esc(u.specialty) : ''}" placeholder="مثال: كهرباء وإضاءة">
          </div>
          <div>
            <p class="label">التصنيفات التي يغطيها *</p>
            <div class="grid gap-2 sm:grid-cols-2">${cats}</div>
          </div>
        </div>
      </div>

      <div class="mt-6 flex gap-3">
        <button class="btn btn-dark flex-1" type="submit"><i data-lucide="${isNew ? 'user-plus' : 'save'}" class="h-4 w-4"></i> ${isNew ? 'إنشاء الحساب' : 'حفظ التعديلات'}</button>
        <button class="btn btn-soft" type="button" data-action="closeModal">إلغاء</button>
      </div>
    </form>`;

  $('#modal').classList.add('open');
  refreshIcons();
  $('#u-name').focus();
}

function toggleTechFields() {
  $('#techFields').classList.toggle('hidden', $('#u-role').value !== 'technician');
}

/* ---------- نافذة تعيين كلمة مرور جديدة ---------- */
function openPasswordModal(id) {
  const u = userById(id);
  if (!u) return;
  $('#modalBody').innerHTML = `
    <form id="passForm" data-id="${u.id}" class="p-6" autocomplete="off">
      <div class="mb-5 flex items-center justify-between">
        <div>
          <h2 class="text-xl font-extrabold">كلمة مرور جديدة</h2>
          <p class="text-sm text-gray-500">${esc(u.name)} · <span dir="ltr">@${esc(u.username)}</span></p>
        </div>
        <button type="button" class="btn btn-soft !p-2.5" data-action="closeModal" aria-label="إغلاق"><i data-lucide="x" class="h-5 w-5"></i></button>
      </div>
      <label class="label" for="p-pass">كلمة المرور الجديدة</label>
      <div class="flex gap-2">
        <input id="p-pass" name="password" type="text" class="field" required minlength="6" autocomplete="new-password" placeholder="6 أحرف على الأقل">
        <button type="button" class="btn btn-soft shrink-0" data-action="genPass"><i data-lucide="wand-sparkles" class="h-4 w-4"></i> توليد</button>
      </div>
      <p class="mt-2 text-xs text-gray-400">سلّم كلمة المرور للمستخدم بشكل آمن، وانصحه بتغييرها بعد أول دخول.</p>
      <div class="mt-6 flex gap-3">
        <button class="btn btn-dark flex-1" type="submit"><i data-lucide="save" class="h-4 w-4"></i> حفظ</button>
        <button class="btn btn-soft" type="button" data-action="closeModal">إلغاء</button>
      </div>
    </form>`;
  $('#modal').classList.add('open');
  refreshIcons();
  $('#p-pass').focus();
}

/* ---------- معالجات النماذج (تُستدعى من حدث submit) ---------- */
const authForms = {
  loginForm(form) {
    const fd = new FormData(form);
    const res = attemptLogin(String(fd.get('username') || ''), String(fd.get('password') || ''));
    const box = $('#loginError');
    if (!res.ok) {
      box.textContent = res.error;
      box.classList.remove('hidden');
      $('#loginPass').value = '';
      $('#loginPass').focus();
      return;
    }
    box.classList.add('hidden');
    form.reset();
    showApp();
    toast(`أهلاً ${res.user.name}`);
  },

  userForm(form) {
    const fd = new FormData(form);
    const id = form.dataset.id;
    const existing = id ? userById(id) : null;
    const data = {
      name: String(fd.get('name') || ''),
      username: String(fd.get('username') || ''),
      password: String(fd.get('password') || ''),
      role: String(fd.get('role') || (existing ? existing.role : 'employee')),
      title: String(fd.get('title') || ''),
      phone: String(fd.get('phone') || ''),
      specialty: String(fd.get('specialty') || ''),
      categories: fd.getAll('categories'),
    };
    const res = existing ? updateUser(id, data) : createUser(data);
    if (!res.ok) { toast(res.error, 'error'); return; }
    closeModal();
    render();
    toast(existing ? 'تم تحديث بيانات الحساب' : `تم إنشاء الحساب @${res.user.username}`);
  },

  passForm(form) {
    const res = setPassword(form.dataset.id, String(new FormData(form).get('password') || ''));
    if (!res.ok) { toast(res.error, 'error'); return; }
    closeModal();
    toast('تم تعيين كلمة المرور الجديدة');
  },

  changePassForm(form) {
    const fd = new FormData(form);
    if (fd.get('next') !== fd.get('repeat')) { toast('تأكيد كلمة المرور غير مطابق', 'error'); return; }
    const res = changeOwnPassword(String(fd.get('current') || ''), String(fd.get('next') || ''));
    if (!res.ok) { toast(res.error, 'error'); return; }
    form.reset();
    toast('تم تحديث كلمة المرور');
  },
};

/* ---------- الدخول والخروج ---------- */
function resetUi() {
  Object.assign(ui, {
    view: 'dashboard', search: '', status: 'all', priority: 'all', ticketId: null,
    weekOffset: 0, day: localDateKey(new Date()), notifOpen: false, userRole: 'all', kpi: {},
  });
  $('#searchInput').value = '';
}

function showApp() {
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  resetUi();
  render();
  window.scrollTo({ top: 0 });
}

function showLogin() {
  closeDrawer();
  closeModal();
  closeSidebar();
  $('#appShell').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  $('#demoBox').classList.toggle('hidden', !DEMO_MODE);
  $('#loginError').classList.add('hidden');
  refreshIcons();
  $('#loginUser').focus();
}

function boot() {
  if (sessionUser()) showApp(); else showLogin();
}

/* ---------- اللوحة الجانبية (الأدوار + التقويم + المهام) ---------- */
function renderPanel() {
  $('#panel').innerHTML = `${profileCard()}${calendarCard()}${checklistCard()}`;
}

function profileCard() {
  const u = currentUser();
  const role = ROLES[u.role];
  return `
    <div class="card p-5">
      <div class="flex items-center gap-3">
        ${avatar(u, 'h-12 w-12 text-lg')}
        <div class="min-w-0 flex-1">
          <p class="truncate font-extrabold">${esc(u.name)}</p>
          <p class="truncate text-xs text-gray-500">${esc(u.title || '')}</p>
        </div>
      </div>
      <div class="mt-4 flex items-center justify-between">
        <span class="pill ${role.badge}"><i data-lucide="${role.icon}" class="h-3 w-3"></i>${role.label}</span>
        <button class="btn btn-soft !px-3 !py-1.5 text-xs" data-action="logout"><i data-lucide="log-out" class="h-3.5 w-3.5"></i> خروج</button>
      </div>
    </div>`;
}

function weekDays() {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const offset = (base.getDay() + 1) % 7; // السبت = 0
  base.setDate(base.getDate() - offset + ui.weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d; });
}

function calendarCard() {
  const days = weekDays();
  const todayKey = localDateKey(new Date());
  const visits = visibleTickets().filter((t) => t.visitDate && t.status !== 'fixed');
  const hasVisit = (key) => visits.some((t) => t.visitDate === key);

  const first = days[0];
  const last = days[6];
  const monthLabel = first.getMonth() === last.getMonth()
    ? `${MONTHS[first.getMonth()]} ${first.getFullYear()}`
    : `${MONTHS[first.getMonth()]} – ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;

  const cells = days.map((d, i) => {
    const key = localDateKey(d);
    return `
      <div class="flex flex-col items-center gap-1.5">
        <span class="text-[11px] font-bold text-gray-400">${DAY_LETTERS[i]}</span>
        <button class="cal-day w-full ${key === todayKey ? 'today' : ''} ${key === ui.day ? 'selected' : ''}" data-action="pickDay" data-day="${key}" aria-label="${key}">
          ${d.getDate()}${hasVisit(key) ? '<span class="dot"></span>' : ''}
        </button>
      </div>`;
  }).join('');

  const dayVisits = visits.filter((t) => t.visitDate === ui.day);
  const list = dayVisits.length
    ? dayVisits.map((t) => {
      const tech = techById(t.assignedTo);
      return `
        <button class="flex w-full items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-start text-xs transition hover:bg-white/15" data-action="openTicket" data-id="${t.id}">
          <i data-lucide="calendar-check" class="h-4 w-4 shrink-0 text-yellow-300"></i>
          <span class="min-w-0 flex-1"><span class="block truncate font-bold">${esc(t.title)}</span>
          <span class="block truncate text-gray-400">${tech ? esc(tech.name) : 'بدون فني'}</span></span>
        </button>`;
    }).join('')
    : '<p class="py-2 text-center text-xs text-gray-400">لا توجد زيارات مجدولة في هذا اليوم</p>';

  return `
    <div class="rounded-3xl bg-gray-900 p-5 text-white shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <button class="grid h-8 w-8 place-items-center rounded-full bg-white/10 hover:bg-white/20" data-action="weekNext" aria-label="الأسبوع التالي"><i data-lucide="chevron-right" class="h-4 w-4"></i></button>
        <div class="text-center">
          <p class="text-sm font-extrabold">${monthLabel}</p>
          <p class="text-[11px] text-gray-400">الزيارات المجدولة</p>
        </div>
        <button class="grid h-8 w-8 place-items-center rounded-full bg-white/10 hover:bg-white/20" data-action="weekPrev" aria-label="الأسبوع السابق"><i data-lucide="chevron-left" class="h-4 w-4"></i></button>
      </div>
      <div class="grid grid-cols-7 gap-1">${cells}</div>
      <div class="mt-4 space-y-2">${list}</div>
    </div>`;
}

function checklistCard() {
  const items = myList().map((c) => `
    <li class="group flex items-center gap-3">
      <button class="check-box ${c.done ? 'done' : ''}" data-action="toggleCheck" data-id="${c.id}" aria-label="تبديل الحالة">
        ${c.done ? '<i data-lucide="check" class="h-3 w-3"></i>' : ''}
      </button>
      <span class="flex-1 text-sm ${c.done ? 'text-gray-400 line-through' : 'font-semibold'}">${esc(c.text)}</span>
      <button class="text-gray-300 opacity-0 transition hover:text-red-500 focus:opacity-100 group-hover:opacity-100" data-action="deleteCheck" data-id="${c.id}" aria-label="حذف">
        <i data-lucide="trash-2" class="h-4 w-4"></i>
      </button>
    </li>`).join('');

  const done = myList().filter((c) => c.done).length;
  return `
    <div class="card p-5">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-base font-extrabold">قائمة سريعة</h3>
        <span class="text-xs font-bold text-gray-400">${done}/${myList().length}</span>
      </div>
      <ul class="space-y-3">${items || '<li class="text-xs text-gray-400">لا توجد مهام</li>'}</ul>
      <form id="checkForm" class="mt-4 flex gap-2">
        <input name="text" class="field" placeholder="أضف مهمة جديدة…" maxlength="80" autocomplete="off">
        <button class="btn btn-dark !px-3.5" aria-label="إضافة"><i data-lucide="plus" class="h-4 w-4"></i></button>
      </form>
    </div>`;
}

/* ---------- الإشعارات ---------- */
function renderNotifications() {
  const list = visibleNotifications();
  const unread = list.filter((n) => !n.read).length;
  const badge = $('#notifBadge');
  badge.textContent = unread;
  badge.classList.toggle('hidden', !unread);

  const menu = $('#notifMenu');
  menu.classList.toggle('hidden', !ui.notifOpen);
  if (!ui.notifOpen) return;

  menu.innerHTML = `
    <div class="mb-2 flex items-center justify-between px-2">
      <p class="text-sm font-extrabold">الإشعارات</p>
      <button class="text-xs font-bold text-indigo-600 hover:underline" data-action="markAllRead">تحديد الكل كمقروء</button>
    </div>
    <div class="max-h-80 space-y-1 overflow-y-auto">
      ${list.map((n) => `
        <button class="flex w-full items-start gap-2 rounded-2xl p-2.5 text-start transition hover:bg-gray-50 ${n.read ? '' : 'bg-indigo-50/60'}" data-action="openNotif" data-id="${n.id}">
          <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-gray-200' : 'bg-indigo-500'}"></span>
          <span class="min-w-0"><span class="block text-xs font-semibold leading-5">${esc(n.text)}</span>
          <span class="text-[11px] text-gray-400">${timeAgo(n.at)}</span></span>
        </button>`).join('') || '<p class="py-6 text-center text-xs text-gray-400">لا توجد إشعارات</p>'}
    </div>`;
}

/* ---------- عدّاد الأرقام المتحرك ---------- */
function animateKpis() {
  $$('[data-kpi]').forEach((el) => {
    const key = el.dataset.kpi;
    const to = Number(el.dataset.value);
    const from = ui.kpi[key] ?? 0;
    ui.kpi[key] = to;
    if (from === to) return;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 500);
      el.textContent = Math.round(from + (to - from) * p);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ==========================================================================
   5) درج تفاصيل البلاغ (Drawer)
   ========================================================================== */
function openDrawer(id) {
  ui.ticketId = id;
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  renderDrawer(true);
  refreshIcons();
}

function closeDrawer() {
  ui.ticketId = null;
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
}

function infoItem(icon, label, value) {
  return `
    <div class="rounded-2xl bg-gray-50 p-3">
      <p class="mb-1 flex items-center gap-1 text-[11px] font-semibold text-gray-400"><i data-lucide="${icon}" class="h-3 w-3"></i>${label}</p>
      <p class="text-sm font-bold">${value}</p>
    </div>`;
}

function renderDrawer(resetScroll = false) {
  const t = getTicket(ui.ticketId);
  const panel = $('#drawerPanel');
  if (!t) { closeDrawer(); return; }
  const scroll = resetScroll ? 0 : panel.scrollTop;

  const cat = CATEGORIES[t.category];
  const pr = PRIORITIES[t.priority];
  const st = STATUSES[t.status];
  const tech = techById(t.assignedTo);
  const stepLabels = [['جديد', 25], ['تم التعيين', 50], ['قيد الإصلاح', 75], ['مكتمل', 100]];

  const roleSection = { manager: managerSection, technician: technicianSection, employee: () => '' }[currentRole()](t);

  const timeline = [...t.timeline].reverse().map((e) => e.kind === 'note' ? `
      <li class="rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
        <div class="mb-1 flex items-center justify-between text-[11px] text-gray-500"><span class="font-bold">${esc(e.by)} · ملاحظة فنية</span><span>${fmtDateTime(e.at)}</span></div>
        <p class="text-sm leading-6">${esc(e.text)}</p>
        ${e.parts ? `<p class="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-orange-600"><i data-lucide="package" class="h-3 w-3"></i>${esc(e.parts)}</p>` : ''}
      </li>` : `
      <li class="flex items-start gap-2 text-sm">
        <span class="mt-2 h-2 w-2 shrink-0 rounded-full bg-gray-300"></span>
        <div class="flex-1"><p class="font-semibold">${esc(e.text)}</p><p class="text-[11px] text-gray-400">${esc(e.by)} · ${fmtDateTime(e.at)}</p></div>
      </li>`).join('');

  panel.innerHTML = `
    <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
      <div class="flex items-center gap-3">
        <div class="icon-tile ${cat.tile}"><i data-lucide="${cat.icon}" class="h-5 w-5"></i></div>
        <div><p class="text-xs font-bold text-gray-400">${t.id}</p><p class="text-sm font-extrabold">${cat.label}</p></div>
      </div>
      <button class="btn btn-soft !p-2.5" data-action="closeDrawer" aria-label="إغلاق"><i data-lucide="x" class="h-5 w-5"></i></button>
    </div>

    <div class="space-y-5 p-6">
      <div>
        <h2 class="text-xl font-extrabold leading-8">${esc(t.title)}</h2>
        <div class="mt-2 flex flex-wrap gap-2">
          <span class="pill ring-1 ring-inset ${pr.badge}">${pr.label}</span>
          <span class="pill ${st.badge}">${st.label}</span>
          ${isBreached(t) ? '<span class="pill bg-red-50 text-red-600">تجاوز SLA</span>' : ''}
        </div>
      </div>

      <div>
        <div class="progress-track"><div class="progress-fill" style="width:${st.progress}%;background:${st.bar}"></div></div>
        <div class="mt-2 flex justify-between text-[11px] font-bold">
          ${stepLabels.map(([l, v]) => `<span class="${st.progress >= v ? 'text-gray-900' : 'text-gray-300'}">${l}</span>`).join('')}
        </div>
      </div>

      <p class="rounded-2xl bg-gray-50 p-4 text-sm leading-7 text-gray-600">${esc(t.description) || 'لا يوجد وصف.'}</p>
      ${t.image ? `<img src="${t.image}" alt="صورة العطل" class="max-h-64 w-full rounded-2xl object-cover">` : ''}

      <div class="grid grid-cols-2 gap-3">
        ${infoItem('map-pin', 'الموقع', esc(t.location))}
        ${infoItem('user', 'مقدّم البلاغ', esc(t.requesterName))}
        ${infoItem('clock', 'تاريخ الرفع', fmtDateTime(t.createdAt))}
        ${infoItem('timer', 'موعد SLA', t.slaDeadline ? fmtDateTime(t.slaDeadline) : 'لم يُحدد')}
        ${infoItem('hard-hat', 'الفني المسؤول', tech ? esc(tech.name) : 'لم يُعيّن')}
        ${infoItem('calendar-days', 'موعد الزيارة', t.visitDate ? fmtDate(t.visitDate) : 'غير مجدولة')}
      </div>

      ${roleSection}

      <div>
        <h3 class="mb-3 text-base font-extrabold">سجل البلاغ</h3>
        <ul class="space-y-3">${timeline}</ul>
      </div>
    </div>`;

  panel.scrollTop = scroll;
}

/* ---------- قسم المسؤول: تعيين فني وتحديد SLA ---------- */
function managerSection(t) {
  if (t.status === 'fixed') {
    return '<div class="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">البلاغ مكتمل ولا يمكن تعديل التعيين.</div>';
  }

  const techs = technicians().map((tc) => {
    const w = workload(tc.id);
    const fit = tc.categories.includes(t.category);
    return `
      <label class="block cursor-pointer">
        <input type="radio" name="tech" value="${tc.id}" class="peer sr-only" ${t.assignedTo === tc.id ? 'checked' : ''}>
        <div class="flex items-center gap-3 rounded-2xl border-2 border-gray-100 p-3 transition peer-checked:border-gray-900 peer-checked:bg-gray-50 hover:border-gray-300">
          ${avatar(tc)}
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 text-sm font-bold">${esc(tc.name)}${fit ? '<span class="pill bg-indigo-50 text-indigo-600">مناسب للتخصص</span>' : ''}</p>
            <p class="text-xs text-gray-500">${esc(tc.specialty)}</p>
          </div>
          <span class="pill ${w >= 3 ? 'bg-red-50 text-red-600' : w ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-600'}">${w} مهام نشطة</span>
        </div>
      </label>`;
  }).join('');

  const prioOptions = Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${t.priority === k ? 'selected' : ''}>${v.label}</option>`).join('');
  const slaValue = toLocalInput(t.slaDeadline || defaultSla(t.priority));

  return `
    <div class="rounded-3xl border border-gray-100 p-4">
      <h3 class="mb-3 text-base font-extrabold">${t.assignedTo ? 'إعادة تعيين الفني' : 'تعيين فني'}</h3>
      <div class="space-y-2">${techs}</div>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <div class="col-span-2">
          <label class="label" for="slaInput">موعد SLA النهائي <span class="font-normal text-gray-400">(مقترح حسب الأولوية)</span></label>
          <input id="slaInput" type="datetime-local" class="field" value="${slaValue}">
        </div>
        <div>
          <label class="label" for="visitInput">موعد الزيارة</label>
          <input id="visitInput" type="date" class="field" value="${t.visitDate || ''}">
        </div>
        <div>
          <label class="label" for="prioInput">الأولوية</label>
          <select id="prioInput" class="field">${prioOptions}</select>
        </div>
      </div>
      <button class="btn btn-dark mt-4 w-full" data-action="saveManager"><i data-lucide="save" class="h-4 w-4"></i> حفظ التعيين</button>
    </div>`;
}

/* ---------- قسم الفني: تحديث الحالة وإضافة ملاحظات ---------- */
function technicianSection(t) {
  if (t.assignedTo !== currentUser().id) {
    return '<div class="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-700">هذا البلاغ غير مُسند إليك.</div>';
  }
  if (t.status === 'fixed') {
    return '<div class="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">تم إصلاح هذا البلاغ وإغلاقه. شكراً لك!</div>';
  }

  const buttons = TECH_FLOW.map((s) => `
    <button class="seg-btn ${t.status === s ? 'active' : ''}" data-action="setStatus" data-status="${s}">${STATUSES[s].label}</button>`).join('');

  return `
    <div class="rounded-3xl border border-gray-100 p-4">
      <h3 class="mb-1 text-base font-extrabold">تحديث الحالة</h3>
      <p class="mb-3 text-xs text-gray-400">الحالة الحالية: ${STATUSES[t.status].label}${t.status === 'assigned' ? ' (جديد بانتظار الاستلام)' : ''}</p>
      <div class="grid grid-cols-2 gap-2">${buttons}</div>

      <div class="mt-4 space-y-3">
        <div>
          <label class="label" for="noteText">ملاحظة فنية</label>
          <textarea id="noteText" rows="3" class="field" placeholder="ماذا وجدت وما الإجراء المتخذ؟"></textarea>
        </div>
        <div>
          <label class="label" for="partsInput">القطع المستخدمة</label>
          <input id="partsInput" class="field" placeholder="مثال: مكثف تشغيل 45µF، وصلة صرف">
        </div>
        <div class="flex gap-2">
          <button class="btn btn-soft flex-1" data-action="addNote"><i data-lucide="message-square-plus" class="h-4 w-4"></i> حفظ الملاحظة</button>
          <button class="btn btn-dark flex-1" data-action="resolve"><i data-lucide="circle-check" class="h-4 w-4"></i> تم الإصلاح</button>
        </div>
      </div>
    </div>`;
}

/* ==========================================================================
   6) نافذة رفع بلاغ جديد
   ========================================================================== */
function openNewTicket() {
  ui.newImage = null;
  const catOptions = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const buildingOptions = BUILDINGS.map((b) => `<option>${b}</option>`).join('');
  const prio = Object.entries(PRIORITIES).map(([k, v], i) => `
    <label class="cursor-pointer">
      <input type="radio" name="priority" value="${k}" class="peer sr-only" ${k === 'medium' ? 'checked' : ''}>
      <span class="seg-btn block peer-checked:!border-gray-900 peer-checked:!bg-gray-900 peer-checked:!text-white">${v.label}</span>
    </label>`).join('');

  $('#modalBody').innerHTML = `
    <form id="ticketForm" class="p-6">
      <div class="mb-5 flex items-center justify-between">
        <h2 class="text-xl font-extrabold">رفع بلاغ صيانة جديد</h2>
        <button type="button" class="btn btn-soft !p-2.5" data-action="closeModal" aria-label="إغلاق"><i data-lucide="x" class="h-5 w-5"></i></button>
      </div>

      <div class="space-y-4">
        <div>
          <label class="label" for="f-title">عنوان البلاغ *</label>
          <input id="f-title" name="title" class="field" required maxlength="90" placeholder="مثال: تسريب مياه في المطبخ">
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="f-cat">القسم / التصنيف</label>
            <select id="f-cat" name="category" class="field">${catOptions}</select>
          </div>
          <div>
            <label class="label">الأولوية</label>
            <div class="grid grid-cols-4 gap-1.5">${prio}</div>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="f-building">المبنى</label>
            <select id="f-building" name="building" class="field">${buildingOptions}</select>
          </div>
          <div>
            <label class="label" for="f-room">الدور / الغرفة *</label>
            <input id="f-room" name="room" class="field" required maxlength="60" placeholder="مثال: الدور الثاني — غرفة 204">
          </div>
        </div>

        <div>
          <label class="label" for="f-desc">وصف المشكلة</label>
          <textarea id="f-desc" name="description" rows="4" class="field" maxlength="600" placeholder="اشرح العطل وما يؤثر عليه…"></textarea>
        </div>

        <div>
          <label class="label">صورة العطل (اختياري)</label>
          <div id="imgPreview" class="hidden"></div>
          <label id="imgPicker" class="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-gray-200 py-6 text-sm text-gray-400 transition hover:border-gray-400">
            <i data-lucide="image-plus" class="h-6 w-6"></i>اضغط لاختيار صورة
            <input id="imgInput" type="file" accept="image/*" class="sr-only">
          </label>
        </div>
      </div>

      <div class="mt-6 flex gap-3">
        <button class="btn btn-dark flex-1" type="submit"><i data-lucide="send" class="h-4 w-4"></i> إرسال البلاغ</button>
        <button class="btn btn-soft" type="button" data-action="closeModal">إلغاء</button>
      </div>
    </form>`;

  $('#modal').classList.add('open');
  refreshIcons();
  $('#f-title').focus();
}

function closeModal() {
  $('#modal').classList.remove('open');
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72)); // ضغط لتوفير مساحة التخزين
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function showImagePreview() {
  const box = $('#imgPreview');
  const picker = $('#imgPicker');
  if (!ui.newImage) {
    box.classList.add('hidden');
    picker.classList.remove('hidden');
    return;
  }
  box.classList.remove('hidden');
  picker.classList.add('hidden');
  box.innerHTML = `
    <div class="relative">
      <img src="${ui.newImage}" alt="معاينة" class="max-h-56 w-full rounded-2xl object-cover">
      <button type="button" class="btn btn-dark absolute left-2 top-2 !p-2" data-action="removeImage" aria-label="إزالة الصورة"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
    </div>`;
  refreshIcons();
}

function submitTicket(form) {
  const data = new FormData(form);
  const user = currentUser();
  const priority = data.get('priority');
  const ticket = {
    id: `MR-${state.seq++}`,
    title: data.get('title').trim(),
    category: data.get('category'),
    priority,
    location: `${data.get('building')} — ${data.get('room').trim()}`,
    requesterId: user.id,
    requesterName: user.name,
    description: data.get('description').trim(),
    image: ui.newImage,
    status: 'new',
    assignedTo: null,
    createdAt: new Date().toISOString(),
    slaDeadline: null,
    timeline: [],
  };
  logEvent(ticket, 'تم رفع البلاغ');
  state.tickets.unshift(ticket);
  notify(`${priority === 'urgent' ? 'بلاغ عاجل جديد' : 'بلاغ جديد'}: ${ticket.title}`, ticket.id, { roles: ['manager'] });

  saveState();
  closeModal();
  ui.view = currentRole() === 'manager' || currentRole() === 'employee' ? 'tickets' : ui.view;
  render();
  toast(`تم رفع البلاغ ${ticket.id} بنجاح`);
}

/* ==========================================================================
   7) إجراءات سير العمل
   ========================================================================== */
function saveManagerForm() {
  const t = getTicket(ui.ticketId);
  if (!t) return;
  const techId = ($('#drawerPanel input[name="tech"]:checked') || {}).value;
  const sla = $('#slaInput').value;
  const visit = $('#visitInput').value;
  const priority = $('#prioInput').value;

  if (!techId && !t.assignedTo) {
    toast('اختر فنياً لتعيين البلاغ أولاً', 'error');
    return;
  }

  if (priority !== t.priority) {
    logEvent(t, `تم تغيير الأولوية إلى «${PRIORITIES[priority].label}»`);
    t.priority = priority;
  }
  if (sla) {
    const iso = new Date(sla).toISOString();
    if (iso !== t.slaDeadline) logEvent(t, `تم تحديد موعد SLA: ${fmtDateTime(iso)}`);
    t.slaDeadline = iso;
  }
  t.visitDate = visit || undefined;

  if (techId && techId !== t.assignedTo) {
    const tech = techById(techId);
    t.assignedTo = techId;
    t.status = 'assigned';
    logEvent(t, `تم تعيين الفني ${tech.name}`);
    notify(`مهمة جديدة مسندة إليك: ${t.title}`, t.id, { roles: ['technician'], techId });
    notify(`تم تعيين فني لبلاغك «${t.title}»`, t.id, { roles: ['employee'], requesterId: t.requesterId });
  }

  saveState();
  render();
  toast('تم حفظ بيانات البلاغ');
}

function changeStatus(t, status) {
  if (t.status === status) return false;
  if (status === 'fixed' && !['inspecting', 'waiting_parts'].includes(t.status)) {
    toast('يجب فحص العطل أولاً قبل إغلاق البلاغ', 'error');
    return false;
  }
  t.status = status;
  if (status === 'fixed') t.fixedAt = new Date().toISOString(); else delete t.fixedAt;
  logEvent(t, `تم تحديث الحالة إلى «${STATUSES[status].label}»`);
  notify(`البلاغ ${t.id} «${t.title}»: ${STATUSES[status].label}`, t.id, { roles: ['manager', 'employee'], requesterId: t.requesterId });
  return true;
}

function addTechNote(t) {
  const text = $('#noteText').value.trim();
  const parts = $('#partsInput').value.trim();
  if (!text && !parts) return false;
  t.timeline.push({ id: uid(), kind: 'note', at: new Date().toISOString(), by: currentUser().name, text: text || 'تم تسجيل القطع المستخدمة', parts });
  return true;
}

function resetDemo() {
  if (!isAdmin()) return;
  if (!window.confirm('سيتم حذف جميع البيانات الحالية وإعادة البيانات التجريبية. هل أنت متأكد؟')) return;
  state = buildSeedState();
  Object.assign(ui, { view: 'dashboard', search: '', status: 'all', priority: 'all', ticketId: null, weekOffset: 0, day: localDateKey(new Date()), kpi: {} });
  $('#searchInput').value = '';
  closeDrawer();
  saveState();
  render();
  toast('تمت إعادة تعيين البيانات التجريبية');
}

/* ==========================================================================
   8) الأحداث (Event Delegation)
   ========================================================================== */
const openSidebar = () => { $('#sidebar').classList.add('open'); $('#sidebarBackdrop').classList.add('show'); };
const closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').classList.remove('show'); };

const actions = {
  nav(el) { ui.view = el.dataset.view; closeSidebar(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  openSidebar, closeSidebar,

  logout() {
    signOut();
    showLogin();
  },
  togglePass(el) {
    const input = el.closest('[data-pass-wrap]').querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? 'إخفاء' : 'إظهار';
  },
  fillLogin(el) {
    $('#loginUser').value = el.dataset.u;
    $('#loginPass').value = el.dataset.p;
    $('#loginError').classList.add('hidden');
  },

  /* ---- إدارة المستخدمين ---- */
  userRole(el) { ui.userRole = el.dataset.role; renderView(); },
  openUser() { openUserModal(); },
  editUser(el) { openUserModal(el.dataset.id); },
  resetPass(el) { openPasswordModal(el.dataset.id); },
  toggleUser(el) {
    const res = toggleActive(el.dataset.id);
    if (!res.ok) { toast(res.error, 'error'); return; }
    render();
    toast(res.user.active ? 'تم تفعيل الحساب' : 'تم إيقاف الحساب');
  },
  deleteUser(el) {
    const user = userById(el.dataset.id);
    if (!user || !window.confirm(`حذف حساب «${user.name}» نهائياً؟`)) return;
    const res = removeUser(user.id);
    if (!res.ok) { toast(res.error, 'error'); return; }
    render();
    toast('تم حذف الحساب');
  },
  genPass(el) {
    const input = el.closest('form').querySelector('input[name="password"]');
    input.value = generatePassword();
    input.type = 'text';
  },

  weekNext() { ui.weekOffset += 1; renderPanel(); refreshIcons(); },
  weekPrev() { ui.weekOffset -= 1; renderPanel(); refreshIcons(); },
  pickDay(el) { ui.day = el.dataset.day; renderPanel(); refreshIcons(); },

  toggleCheck(el) {
    const item = myList().find((c) => c.id === el.dataset.id);
    if (item) item.done = !item.done;
    saveState(); renderPanel(); refreshIcons();
  },
  deleteCheck(el) {
    state.checklists[currentUser().id] = myList().filter((c) => c.id !== el.dataset.id);
    saveState(); renderPanel(); refreshIcons();
  },

  toggleNotif() { ui.notifOpen = !ui.notifOpen; renderNotifications(); refreshIcons(); },
  markAllRead() {
    visibleNotifications().forEach((n) => { n.read = true; });
    saveState(); renderNotifications(); refreshIcons();
  },
  openNotif(el) {
    const n = state.notifications.find((x) => x.id === el.dataset.id);
    if (!n) return;
    n.read = true;
    ui.notifOpen = false;
    saveState(); renderNotifications();
    if (n.ticketId && getTicket(n.ticketId)) openDrawer(n.ticketId);
  },
  clearNotifs() {
    const mine = new Set(visibleNotifications().map((n) => n.id));
    state.notifications = state.notifications.filter((n) => !mine.has(n.id));
    saveState(); render(); toast('تم مسح الإشعارات');
  },

  openTicket(el) { openDrawer(el.dataset.id); },
  closeDrawer,
  openNew: openNewTicket,
  closeModal,
  modalBackdrop(el, e) { if (e.target === el) closeModal(); },
  removeImage() { ui.newImage = null; showImagePreview(); },

  saveManager: saveManagerForm,

  setStatus(el) {
    const t = getTicket(ui.ticketId);
    if (!t || t.assignedTo !== currentUser().id) return;
    const noted = addTechNote(t);
    if (changeStatus(t, el.dataset.status) || noted) {
      saveState(); render();
      toast(`تم تحديث الحالة: ${STATUSES[t.status].label}`);
    }
  },
  addNote() {
    const t = getTicket(ui.ticketId);
    if (!t) return;
    if (!addTechNote(t)) { toast('اكتب ملاحظة أو القطع المستخدمة أولاً', 'error'); return; }
    saveState(); render(); toast('تم حفظ الملاحظة');
  },
  resolve() {
    const t = getTicket(ui.ticketId);
    if (!t) return;
    addTechNote(t);
    if (changeStatus(t, 'fixed')) {
      saveState(); render(); toast('تم إغلاق البلاغ بنجاح 🎉');
    } else {
      saveState(); render();
    }
  },

  resetDemo,
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) {
    if (ui.notifOpen && !e.target.closest('#notifWrap')) { ui.notifOpen = false; renderNotifications(); }
    return;
  }
  const name = el.dataset.action;
  if (ui.notifOpen && !el.closest('#notifWrap')) { ui.notifOpen = false; renderNotifications(); }
  if (actions[name]) actions[name](el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#modal').classList.contains('open')) closeModal();
    else if (ui.ticketId) closeDrawer();
    closeSidebar();
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ticket-card')) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'ticketForm') submitTicket(e.target);
  if (authForms[e.target.id]) authForms[e.target.id](e.target);
  if (e.target.id === 'checkForm') {
    const text = new FormData(e.target).get('text').trim();
    if (!text) return;
    myList().push({ id: uid(), text, done: false });
    saveState(); renderPanel(); refreshIcons();
    $('#checkForm input').focus();
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.filter) {
    ui[el.dataset.filter] = el.value;
    renderView();
  }
  if (el.id === 'u-role') toggleTechFields();
  if (el.id === 'imgInput' && el.files[0]) {
    try {
      ui.newImage = await readImage(el.files[0]);
      showImagePreview();
    } catch (_) {
      toast('تعذر قراءة الصورة', 'error');
    }
  }
});

// البحث الفوري: يحدّث العرض فقط حتى لا يفقد الحقل التركيز
$('#searchInput').addEventListener('input', (e) => {
  ui.search = e.target.value;
  renderView();
});

/* ==========================================================================
   9) التشغيل
   ========================================================================== */
boot();

/* ==========================================================================
   data.js — الثوابت والبيانات التجريبية (Seed Data)
   ========================================================================== */

const STORAGE_KEY = 'cmms_state_v2';
const DEMO_MODE = true; // اجعلها false لإخفاء الحسابات التجريبية من شاشة الدخول
const CAPACITY_PER_TECH = 5; // الحد الأقصى المقترح للمهام النشطة لكل فني

/* ---------- التصنيفات ---------- */
const CATEGORIES = {
  electrical: { label: 'كهرباء', icon: 'zap', tile: 'bg-amber-100 text-amber-600' },
  hvac: { label: 'تكييف وتبريد', icon: 'snowflake', tile: 'bg-sky-100 text-sky-600' },
  plumbing: { label: 'سباكة', icon: 'droplets', tile: 'bg-cyan-100 text-cyan-600' },
  it: { label: 'شبكات وأنظمة IT', icon: 'monitor', tile: 'bg-violet-100 text-violet-600' },
  furniture: { label: 'نجارة وأثاث', icon: 'armchair', tile: 'bg-orange-100 text-orange-600' },
  cleaning: { label: 'نظافة ومرافق عامة', icon: 'sparkles', tile: 'bg-emerald-100 text-emerald-600' },
};

/* ---------- الأولويات ---------- */
const PRIORITIES = {
  urgent: { label: 'عاجل', rank: 0, slaHours: 4, badge: 'bg-red-50 text-red-600 ring-red-200' },
  high: { label: 'عالية', rank: 1, slaHours: 24, badge: 'bg-orange-50 text-orange-600 ring-orange-200' },
  medium: { label: 'متوسطة', rank: 2, slaHours: 48, badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  low: { label: 'منخفضة', rank: 3, slaHours: 72, badge: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
};

/* ---------- الحالات (progress = نسبة التقدم) ---------- */
const STATUSES = {
  new: { label: 'جديد', progress: 25, badge: 'bg-slate-100 text-slate-600', bar: '#94A3B8' },
  assigned: { label: 'تم التعيين', progress: 50, badge: 'bg-indigo-50 text-indigo-600', bar: '#818CF8' },
  received: { label: 'تم الاستلام', progress: 50, badge: 'bg-blue-50 text-blue-600', bar: '#60A5FA' },
  inspecting: { label: 'قيد الفحص', progress: 75, badge: 'bg-amber-50 text-amber-700', bar: '#FBBF24' },
  waiting_parts: { label: 'بانتظار قطع غيار', progress: 75, badge: 'bg-orange-50 text-orange-600', bar: '#FB923C' },
  fixed: { label: 'تم الإصلاح', progress: 100, badge: 'bg-emerald-50 text-emerald-600', bar: '#34D399' },
};
const ACTIVE_STATUSES = ['assigned', 'received', 'inspecting', 'waiting_parts']; // قيد الإصلاح
const TECH_FLOW = ['received', 'inspecting', 'waiting_parts', 'fixed'];       // خطوات الفني

const BUILDINGS = ['المبنى الإداري', 'المبنى الرئيسي', 'مبنى الفروع', 'المستودع', 'مبنى الخدمات'];

const ROLES = {
  admin: { label: 'مدير النظام', icon: 'shield-check', badge: 'bg-gray-900 text-white' },
  manager: { label: 'مسؤول صيانة', icon: 'clipboard-check', badge: 'bg-indigo-50 text-indigo-600' },
  technician: { label: 'فني صيانة', icon: 'hard-hat', badge: 'bg-amber-50 text-amber-700' },
  employee: { label: 'موظف', icon: 'user', badge: 'bg-emerald-50 text-emerald-600' },
};

/* ألوان الصور الرمزية للحسابات */
const AVATAR_COLORS = ['#6366F1', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#0EA5E9', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444'];

/* حجم البلاغات للأشهر الخمسة السابقة (الشهر الحالي يُحسب من التذاكر الفعلية) */
const MONTH_BASELINE = [
  { total: 14, closed: 14 },
  { total: 17, closed: 16 },
  { total: 15, closed: 15 },
  { total: 21, closed: 20 },
  { total: 19, closed: 18 },
];

/* ---------- أدوات تاريخ مشتركة ---------- */
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ---------- البيانات الأولية ---------- */
function buildSeedState() {
  const H = 3600e3;
  const at = (hours) => new Date(Date.now() + hours * H).toISOString();
  const dayKey = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return localDateKey(d);
  };
  const ev = (hours, by, text) => ({ id: uid(), kind: 'event', at: at(hours), by, text });
  const note = (hours, by, text, parts = '') => ({ id: uid(), kind: 'note', at: at(hours), by, text, parts });

  const emp = { requesterId: 'u-emp', requesterName: 'أحمد الشمري' };

  /* الحسابات: كلمة مرور الجميع 123456 عدا مدير النظام (admin123) */
  const account = (id, name, username, role, title, extra = {}) => ({
    id, name, username, role, title, phone: '', active: true, createdAt: at(-2000),
    color: AVATAR_COLORS[(username.length * 7 + id.length) % AVATAR_COLORS.length],
    passHash: hashPassword(username, role === 'admin' ? 'admin123' : '123456'),
    ...extra,
  });

  const users = [
    account('u-admin', 'مدير النظام', 'admin', 'admin', 'مدير النظام', { color: '#111827' }),
    account('u-mgr', 'م. سارة العتيبي', 'sara', 'manager', 'مسؤولة الصيانة والمرافق', { color: '#6366F1', phone: '0550000001' }),
    account('u-emp', 'أحمد الشمري', 'ahmed', 'employee', 'موظف — إدارة المبيعات', { color: '#EC4899', phone: '0550000002' }),
    account('u-ext-1', 'نورة السبيعي', 'noura', 'employee', 'موظفة — الموارد البشرية', { color: '#14B8A6' }),
    account('u-ext-2', 'ماجد الدوسري', 'majed', 'employee', 'موظف — تقنية المعلومات', { color: '#F97316' }),
    account('u-ext-3', 'سلطان الغامدي', 'sultan', 'employee', 'موظف — المستودعات', { color: '#84CC16' }),
    account('t1', 'خالد المطيري', 'khaled', 'technician', 'فني كهرباء وإضاءة', { specialty: 'كهرباء وإضاءة', categories: ['electrical'], phone: '0551234567', color: '#F59E0B' }),
    account('t2', 'فهد القحطاني', 'fahad', 'technician', 'فني تكييف وتبريد', { specialty: 'تكييف وتبريد', categories: ['hvac'], phone: '0552345678', color: '#0EA5E9' }),
    account('t3', 'ياسر الحربي', 'yasser', 'technician', 'فني شبكات وأنظمة IT', { specialty: 'شبكات وأنظمة IT', categories: ['it'], phone: '0553456789', color: '#8B5CF6' }),
    account('t4', 'عبدالله الزهراني', 'abdullah', 'technician', 'فني سباكة وصيانة عامة', { specialty: 'سباكة وصيانة عامة', categories: ['plumbing', 'furniture', 'cleaning'], phone: '0554567890', color: '#10B981' }),
  ];

  const tickets = [
    {
      
    },
    {
      id: 'MR-1002', title: 'انقطاع الإنترنت في قاعة الاجتماعات', category: 'it', priority: 'high',
      location: 'المبنى الرئيسي — الدور الأول — قاعة الاجتماعات B', requesterId: 'u-ext-1', requesterName: 'نورة السبيعي',
      description: 'شبكة الواي فاي ونقطة الشبكة السلكية لا تعملان داخل القاعة منذ الصباح، وهناك اجتماع مهم غداً.',
      image: null, status: 'received', assignedTo: 't3', createdAt: at(-20), slaDeadline: at(3), visitDate: dayKey(0),
      timeline: [
        ev(-20, 'نورة السبيعي', 'تم رفع البلاغ'),
        ev(-18, 'م. سارة العتيبي', 'تم تعيين الفني ياسر الحربي'),
        ev(-2, 'ياسر الحربي', 'تم تحديث الحالة إلى «تم الاستلام»'),
      ],
    },
    {
      id: 'MR-1003', title: 'مكيف غرفة الخوادم لا يبرّد', category: 'hvac', priority: 'urgent',
      location: 'المبنى الرئيسي — البدروم — غرفة الخوادم', requesterId: 'u-ext-2', requesterName: 'ماجد الدوسري',
      description: 'درجة الحرارة داخل الغرفة ترتفع إلى أكثر من 30 درجة وتظهر رسالة خطأ على وحدة المكيف.',
      image: null, status: 'waiting_parts', assignedTo: 't2', createdAt: at(-72), slaDeadline: at(-5), visitDate: dayKey(2),
      timeline: [
        ev(-72, 'ماجد الدوسري', 'تم رفع البلاغ'),
        ev(-70, 'م. سارة العتيبي', 'تم تعيين الفني فهد القحطاني'),
        ev(-52, 'فهد القحطاني', 'تم تحديث الحالة إلى «قيد الفحص»'),
        ev(-26, 'فهد القحطاني', 'تم تحديث الحالة إلى «بانتظار قطع غيار»'),
        note(-26, 'فهد القحطاني', 'الضاغط يعمل بشكل متقطع ويحتاج استبدال مكثف التشغيل.', 'مكثف تشغيل 45µF'),
      ],
    },
    {
      id: 'MR-1004', title: 'استبدال إنارة LED في الممر الشرقي', category: 'electrical', priority: 'low',
      location: 'مبنى الفروع — الدور الأرضي — الممر الشرقي', ...emp,
      description: 'ثلاث وحدات إنارة محترقة في الممر وتحتاج استبدالاً.',
      image: null, status: 'fixed', assignedTo: 't1', createdAt: at(-150), slaDeadline: at(-100), fixedAt: at(-110),
      timeline: [
        ev(-150, 'أحمد الشمري', 'تم رفع البلاغ'),
        ev(-146, 'م. سارة العتيبي', 'تم تعيين الفني خالد المطيري'),
        note(-110, 'خالد المطيري', 'تم استبدال الوحدات الثلاث واختبار التشغيل.', '3 × لمبة LED 18W'),
        ev(-110, 'خالد المطيري', 'تم تحديث الحالة إلى «تم الإصلاح»'),
      ],
    },
    {
      id: 'MR-1005', title: 'كرسي مكتب مكسور', category: 'furniture', priority: 'medium',
      location: 'المبنى الإداري — الدور الثالث — مكتب 312', ...emp,
      description: 'مسند الكرسي مكسور ولا يمكن ضبط الارتفاع.',
      image: null, status: 'new', assignedTo: null, createdAt: at(-3), slaDeadline: null,
      timeline: [ev(-3, 'أحمد الشمري', 'تم رفع البلاغ')],
    },
    {
      id: 'MR-1006', title: 'الطابعة الشبكية لا تتصل', category: 'it', priority: 'medium',
      location: 'المبنى الإداري — الدور الثالث — غرفة الطباعة', ...emp,
      description: 'الطابعة تظهر غير متصلة لجميع موظفي الدور رغم أنها تعمل.',
      image: null, status: 'assigned', assignedTo: 't3', createdAt: at(-26), slaDeadline: at(40), visitDate: dayKey(1),
      timeline: [
        ev(-26, 'أحمد الشمري', 'تم رفع البلاغ'),
        ev(-5, 'م. سارة العتيبي', 'تم تعيين الفني ياسر الحربي'),
      ],
    },
    {
      id: 'MR-1007', title: 'ماس كهربائي في لوحة التوزيع الفرعية', category: 'electrical', priority: 'urgent',
      location: 'المستودع — الجهة الغربية — لوحة التوزيع', requesterId: 'u-ext-3', requesterName: 'سلطان الغامدي',
      description: 'سُمعت فرقعة من اللوحة مع رائحة احتراق خفيفة، وتم فصل القاطع الرئيسي احترازياً.',
      image: null, status: 'new', assignedTo: null, createdAt: at(-1), slaDeadline: null,
      timeline: [ev(-1, 'سلطان الغامدي', 'تم رفع البلاغ')],
    },
    {
      id: 'MR-1008', title: 'تنظيف وتعقيم المصلى', category: 'cleaning', priority: 'low',
      location: 'المبنى الرئيسي — الدور الأرضي — المصلى', requesterId: 'u-ext-1', requesterName: 'نورة السبيعي',
      description: 'طلب تنظيف عميق وتعقيم للسجاد ودورات الوضوء.',
      image: null, status: 'fixed', assignedTo: 't4', createdAt: at(-220), slaDeadline: at(-190), fixedAt: at(-200),
      timeline: [
        ev(-220, 'نورة السبيعي', 'تم رفع البلاغ'),
        ev(-215, 'م. سارة العتيبي', 'تم تعيين الفني عبدالله الزهراني'),
        note(-200, 'عبدالله الزهراني', 'تم التنظيف والتعقيم بالكامل.', 'مواد تعقيم'),
        ev(-200, 'عبدالله الزهراني', 'تم تحديث الحالة إلى «تم الإصلاح»'),
      ],
    },
  ];

  return {
    seq: 1009,
    users,
    tickets,
    notifications: [
      { id: uid(), text: 'بلاغ عاجل جديد: ماس كهربائي في لوحة التوزيع الفرعية', ticketId: 'MR-1007', roles: ['manager'], read: false, at: at(-1) },
      { id: uid(), text: 'تم تعيين فني لبلاغك «الطابعة الشبكية لا تتصل»', ticketId: 'MR-1006', roles: ['employee'], requesterId: 'u-emp', read: false, at: at(-5) },
      { id: uid(), text: 'مهمة جديدة مسندة إليك: انقطاع الإنترنت في قاعة الاجتماعات', ticketId: 'MR-1002', roles: ['technician'], techId: 't3', read: false, at: at(-18) },
      { id: uid(), text: 'بلاغ «مكيف غرفة الخوادم» بانتظار قطع غيار وتجاوز موعد SLA', ticketId: 'MR-1003', roles: ['manager'], read: true, at: at(-26) },
    ],
    checklists: { 'u-mgr': [
      { id: uid(), text: 'مراجعة البلاغات العاجلة صباحاً', done: true },
      { id: uid(), text: 'التأكد من توفر قطع غيار المكيفات', done: false },
      { id: uid(), text: 'جولة تفتيش على لوحات الكهرباء', done: false },
    ], 'u-admin': [] },
  };
}

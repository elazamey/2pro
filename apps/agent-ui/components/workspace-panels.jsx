"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./icon.jsx";

export const navigationItems = [
  { id: "chat", label: "الرئيسية", icon: "home" },
  { id: "tasks", label: "المهام", icon: "list" },
  { id: "projects", label: "المشاريع", icon: "folder" },
  { id: "favorites", label: "المفضلة", icon: "star" },
  { id: "scheduled", label: "المجدولة", icon: "calendar" },
  { id: "library", label: "المكتبة", icon: "book" },
  { id: "settings", label: "الإعدادات", icon: "settings" },
];

export const initialTasks = [
  {
    id: "task-launch",
    title: "إطلاق واجهة 2pro",
    description: "تحضير خطوات النشر ومراجعة إعدادات الأمان.",
    status: "completed",
    updated: "منذ ساعة",
    projectId: "project-2pro",
    favorite: true,
    prompt: "جهّز واجهة 2pro للنشر على Vercel، ووضّح خطوات التحقق قبل الإطلاق.",
  },
  {
    id: "task-figma",
    title: "مراجعة تصميم Figma",
    description: "استخراج المكونات والألوان ومقارنتها بالواجهة.",
    status: "waiting",
    updated: "أمس",
    projectId: "project-2pro",
    favorite: false,
    prompt: "راجع تصميم Figma للمشروع واستخرج المكونات والألوان التي ينبغي تنفيذها.",
  },
  {
    id: "task-audit",
    title: "مراجعة مستودع GitHub",
    description: "فحص بنية المشروع قبل الإصدار التالي.",
    status: "paused",
    updated: "قبل يومين",
    projectId: "project-2pro",
    favorite: false,
    prompt: "افحص مستودع GitHub وحدد أهم التحسينات المطلوبة قبل نشر الإصدار القادم.",
  },
];

export const initialProjects = [
  {
    id: "project-2pro",
    name: "2pro Workspace",
    description: "تطوير واجهات وأدوات منصة 2pro.",
    tasks: 3,
    files: 4,
    favorite: true,
    instructions: "حافظ على TypeScript والاختبارات، ولا تنفّذ إجراءات خارجية دون تأكيد.",
  },
  {
    id: "project-launch",
    name: "إطلاق المنتج",
    description: "مساحة تخطيط الإطلاق ومراجعة التجربة.",
    tasks: 2,
    files: 2,
    favorite: false,
    instructions: "اعرض خطة قابلة للمراجعة قبل أي نشر.",
  },
];

export const initialSchedules = [
  { id: "schedule-weekly", title: "ملخص أسبوعي للمستودع", schedule: "كل اثنين · 09:00", nextRun: "الاثنين القادم", enabled: true, lastRun: "اكتمل الأسبوع الماضي" },
  { id: "schedule-check", title: "فحص تحديثات الاعتماديات", schedule: "يوميًا · 08:30", nextRun: "غدًا", enabled: false, lastRun: "متوقف مؤقتًا" },
];

export const initialFiles = [
  { id: "file-report", name: "launch-plan.md", type: "document", detail: "خطة الإطلاق · 12 KB", updated: "منذ ساعة", source: "إطلاق واجهة 2pro" },
  { id: "file-tokens", name: "design-tokens.json", type: "code", detail: "رموز التصميم · 8 KB", updated: "أمس", source: "مراجعة تصميم Figma" },
  { id: "file-hero", name: "hero-preview.png", type: "image", detail: "معاينة صورة · 340 KB", updated: "قبل يومين", source: "إطلاق المنتج" },
  { id: "file-link", name: "مستند متطلبات المشروع", type: "link", detail: "رابط محفوظ", updated: "قبل 3 أيام", source: "2pro Workspace" },
];

export const connectorOptions = [
  { id: "github", name: "GitHub", detail: "المستودعات وطلبات السحب", icon: "github", connected: false },
  { id: "google-drive", name: "Google Drive", detail: "البحث في الملفات", icon: "folder", connected: false },
  { id: "figma", name: "Figma", detail: "التصميم والرموز", icon: "layers", connected: false },
  { id: "telegram", name: "Telegram", detail: "المحادثة والتنبيهات", icon: "telegram", connected: false },
  { id: "custom-mcp", name: "خادم MCP مخصص", detail: "أضف أدواتك الخاصة", icon: "plug", connected: false },
];

export const skillOptions = [
  { command: "/research", title: "بحث متعمق", description: "اجمع مصادر ثم لخّصها", mode: "research" },
  { command: "/analyze", title: "تحليل", description: "افحص البيانات أو المستودع", mode: "analyze" },
  { command: "/report", title: "إنشاء تقرير", description: "حوّل النتائج إلى تقرير", mode: "create" },
];

export const modeOptions = [
  { id: "chat", name: "محادثة", detail: "إجابة مباشرة", icon: "message" },
  { id: "agent", name: "وكيل", detail: "نفّذ بخطوات وأدوات", icon: "sparkle" },
  { id: "research", name: "بحث", detail: "اجمع المصادر أولًا", icon: "search" },
  { id: "analyze", name: "تحليل", detail: "حلّل الملفات والبيانات", icon: "layers" },
];

const statusLabels = {
  queued: "في الانتظار",
  running: "قيد التنفيذ",
  waiting: "بانتظارك",
  permission: "يتطلب إذنًا",
  paused: "متوقف مؤقتًا",
  completed: "مكتمل",
  failed: "فشل",
  cancelled: "أُلغي",
};

function PageHeader({ eyebrow, title, description, action, onAction }) {
  return (
    <div className="workspace-page-header">
      <div>
        <div className="page-eyebrow-row">{eyebrow && <div className="page-eyebrow">{eyebrow}</div>}<span className="page-demo-badge">معاينة محلية</span></div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <button className="primary-small-button" onClick={onAction}><Icon name="plus" size={15} />{action}</button>}
    </div>
  );
}

function TaskCard({ task, projectName, onOpen, onFavorite, onMenu }) {
  return (
    <article className="workspace-task-card">
      <button className="task-card-open" onClick={() => onOpen(task)}>
        <span className={`task-status-icon task-status-${task.status}`}><Icon name={task.status === "completed" ? "check" : task.status === "running" ? "sparkle" : task.status === "waiting" || task.status === "permission" ? "bell" : "clock"} size={15} /></span>
        <span className="task-card-copy">
          <strong>{task.title}</strong>
          <small>{task.description}</small>
          <span className="task-card-meta"><span className={`task-status-label task-label-${task.status}`}>{statusLabels[task.status] || statusLabels.queued}</span><i />{projectName || "بدون مشروع"}<i />{task.updated}</span>
        </span>
      </button>
      <div className="task-card-actions">
        <button className={`icon-button task-favorite${task.favorite ? " is-favorite" : ""}`} aria-label={task.favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"} onClick={() => onFavorite(task.id)}><Icon name="star" size={16} /></button>
        <button className="icon-button task-more" aria-label="إجراءات المهمة" onClick={() => onMenu(task.id)}><Icon name="dots" size={17} /></button>
      </div>
    </article>
  );
}

function TaskListView({ tasks, projects, onOpenTask, onToggleFavorite, onToast }) {
  const [filter, setFilter] = useState("all");
  const [menuTask, setMenuTask] = useState(null);
  const filters = [
    { id: "all", label: "الكل" },
    { id: "running", label: "قيد التنفيذ" },
    { id: "waiting", label: "بانتظارك" },
    { id: "completed", label: "مكتملة" },
    { id: "failed", label: "فشلت" },
  ];
  const filtered = tasks.filter((task) => filter === "all" || task.status === filter || (filter === "waiting" && task.status === "permission"));
  return (
    <div className="workspace-page">
      <PageHeader eyebrow="مساحة العمل" title="المهام" description="كل مهمة وحدة عمل لها حالة وسياق ونتيجة." action="مهمة جديدة" onAction={() => onOpenTask(null)} />
      <div className="page-filter-row" role="tablist" aria-label="تصفية المهام">
        {filters.map((item) => <button key={item.id} role="tab" aria-selected={filter === item.id} className={filter === item.id ? "filter-chip filter-chip-active" : "filter-chip"} onClick={() => setFilter(item.id)}>{item.label}<span>{item.id === "all" ? tasks.length : tasks.filter((task) => task.status === item.id).length}</span></button>)}
      </div>
      {filtered.length ? (
        <div className="workspace-task-list">
          {filtered.map((task) => (
            <div className="task-card-wrap" key={task.id}>
              <TaskCard task={task} projectName={projects.find((project) => project.id === task.projectId)?.name} onOpen={onOpenTask} onFavorite={onToggleFavorite} onMenu={setMenuTask} />
              {menuTask === task.id && <div className="task-context-menu" role="menu">
                <button onClick={() => { onOpenTask(task); setMenuTask(null); }}><Icon name="external" size={14} />فتح المهمة</button>
                <button onClick={() => { onToggleFavorite(task.id); setMenuTask(null); }}><Icon name="star" size={14} />{task.favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}</button>
                <button onClick={() => { onToast("أُضيفت قائمة الأرشفة إلى نموذج الواجهة."); setMenuTask(null); }}><Icon name="archive" size={14} />أرشفة</button>
                <button className="danger-menu-item" onClick={() => { onToast("الحذف يحتاج تأكيدًا من إعدادات المهمة."); setMenuTask(null); }}><Icon name="trash" size={14} />حذف</button>
              </div>}
            </div>
          ))}
        </div>
      ) : <EmptyState icon="list" title="لا توجد مهام لهذا التصنيف" detail="جرّب حالة أخرى أو ابدأ مهمة جديدة." />}
    </div>
  );
}

function ProjectView({ projects, tasks, onOpenProject, onToast }) {
  return (
    <div className="workspace-page">
      <PageHeader eyebrow="حاويات السياق" title="المشاريع" description="اجمع التعليمات والملفات والمهام والتكاملات في مساحة واحدة." action="مشروع جديد" onAction={() => onToast("إنشاء المشاريع متاح كواجهة تجريبية؛ الحفظ يحتاج مساحة عمل خلفية.")} />
      <div className="project-grid">
        {projects.map((project, index) => (
          <article className="project-card" key={project.id}>
            <div className="project-card-top"><span className={`project-icon project-icon-${index}`}><Icon name="folder" size={19} /></span><button className="icon-button" aria-label="خيارات المشروع" onClick={() => onToast("خيارات المشروع: مشاركة، إعادة تسمية، نقل أو أرشفة.")}><Icon name="dots" /></button></div>
            <h2>{project.name}</h2><p>{project.description}</p>
            <div className="project-stats"><span><Icon name="list" size={13} />{tasks.filter((task) => task.projectId === project.id).length} مهام</span><span><Icon name="fileText" size={13} />{project.files} ملفات</span></div>
            <div className="project-context-preview"><strong>تعليمات المشروع</strong><small>{project.instructions}</small></div>
            <button className="project-open-button" onClick={() => onOpenProject(project)}>فتح مساحة المشروع <Icon name="chevron" size={14} /></button>
          </article>
        ))}
      </div>
      <div className="project-note"><Icon name="shield" size={15} /> المشروع يحفظ السياق؛ ربطه بالخدمات لا يمنحها صلاحية تلقائيًا.</div>
      {projects.length > 0 && <div className="project-recent-tasks"><h3>مهام المشاريع</h3>{tasks.slice(0, 2).map((task) => <button key={task.id} onClick={() => onOpenProject(projects.find((project) => project.id === task.projectId) || projects[0])}><Icon name="message" size={14} /><span>{task.title}</span><small>{task.updated}</small></button>)}</div>}
    </div>
  );
}

function FavoritesView({ tasks, projects, onOpenTask, onOpenProject, onToggleFavorite, onToast }) {
  const favoriteTasks = tasks.filter((task) => task.favorite);
  const favoriteProjects = projects.filter((project) => project.favorite);
  return (
    <div className="workspace-page">
      <PageHeader eyebrow="اختصاراتك" title="المفضلة" description="ارجع بسرعة إلى المهام والمشاريع المهمة." />
      <div className="section-subheading"><h2>مهام محفوظة</h2><span>{favoriteTasks.length}</span></div>
      {favoriteTasks.length ? <div className="workspace-task-list">{favoriteTasks.map((task) => <TaskCard key={task.id} task={task} projectName={projects.find((project) => project.id === task.projectId)?.name} onOpen={onOpenTask} onFavorite={onToggleFavorite} onMenu={() => onToast("خيارات المهمة متاحة من صفحة المهام.")} />)}</div> : <EmptyState icon="star" title="لا توجد مهام مفضلة بعد" detail="اضغط النجمة على مهمة لحفظها هنا." />}
      <div className="section-subheading section-subheading-spaced"><h2>مشاريع محفوظة</h2><span>{favoriteProjects.length}</span></div>
      {favoriteProjects.length ? <div className="favorite-project-list">{favoriteProjects.map((project) => <button key={project.id} onClick={() => onOpenProject(project)}><span className="project-icon"><Icon name="folder" size={16} /></span><span><strong>{project.name}</strong><small>{project.description}</small></span><Icon name="chevron" size={14} /></button>)}</div> : <EmptyState icon="folder" title="لا توجد مشاريع محفوظة" detail="يمكنك إضافة مشروع للمفضلة من قائمة خياراته." />}
    </div>
  );
}

function ScheduledView({ schedules, onToggle, onToast }) {
  return (
    <div className="workspace-page">
      <PageHeader eyebrow="تشغيل تلقائي" title="المهام المجدولة" description="الجدولة نموذج أولي هنا؛ لا توجد مهام تعمل تلقائيًا حتى يُربط مجدول خلفي." action="جدولة مهمة" onAction={() => onToast("إعداد الجدولة يحتاج خدمة Jobs وتخزينًا مستمرًا.")} />
      <div className="schedule-list">
        {schedules.map((schedule) => (
          <article className="schedule-card" key={schedule.id}>
            <span className={`schedule-icon${schedule.enabled ? " schedule-enabled" : ""}`}><Icon name="calendar" size={18} /></span>
            <div className="schedule-copy"><strong>{schedule.title}</strong><span>{schedule.schedule}</span><small>التشغيل القادم: {schedule.nextRun} · {schedule.lastRun}</small></div>
            <button className={`toggle-switch${schedule.enabled ? " toggle-on" : ""}`} aria-label={schedule.enabled ? "إيقاف الجدولة" : "تفعيل الجدولة"} aria-pressed={schedule.enabled} onClick={() => onToggle(schedule.id)}><i /></button>
            <button className="icon-button schedule-more" aria-label="خيارات الجدولة" onClick={() => onToast("تتضمن دورة الجدولة: تعديل، إيقاف، أو حذف بعد ربط Jobs.")}><Icon name="dots" /></button>
          </article>
        ))}
      </div>
      <div className="schedule-note"><Icon name="bell" size={15} />عند ربط مجدول دائم، ستظهر هنا آخر نتيجة وسجل كل تشغيل.</div>
    </div>
  );
}

function LibraryView({ files, onOpenFile, onToast }) {
  const [filter, setFilter] = useState("all");
  const filters = [{ id: "all", label: "الكل" }, { id: "document", label: "مستندات" }, { id: "image", label: "صور" }, { id: "code", label: "كود" }, { id: "link", label: "روابط" }];
  const visible = files.filter((file) => filter === "all" || file.type === filter);
  const iconByType = { document: "fileText", image: "image", code: "code", link: "external" };
  return (
    <div className="workspace-page">
      <PageHeader eyebrow="المخرجات والسياق" title="المكتبة" description="ملفات وروابط ومخرجات المهام في مكان واحد." action="إضافة ملف" onAction={() => onToast("رفع الملفات غير موصول بعد؛ يمكنك اختيار ملف في Composer للمعاينة المحلية فقط.")} />
      <div className="page-filter-row" role="tablist" aria-label="تصفية المكتبة">
        {filters.map((item) => <button key={item.id} role="tab" aria-selected={filter === item.id} className={filter === item.id ? "filter-chip filter-chip-active" : "filter-chip"} onClick={() => setFilter(item.id)}>{item.label}</button>)}
      </div>
      <div className="library-list">
        {visible.map((file) => (
          <button className="library-file-row" key={file.id} onClick={() => onOpenFile(file)}>
            <span className={`library-file-icon library-${file.type}`}><Icon name={iconByType[file.type] || "fileText"} size={18} /></span>
            <span className="library-file-copy"><strong>{file.name}</strong><small>{file.detail} · {file.source}</small></span>
            <span className="library-updated">{file.updated}</span>
            <span className="library-file-actions"><Icon name="external" size={14} /></span>
          </button>
        ))}
      </div>
      <div className="library-note"><Icon name="lock" size={14} />ملفات المعاينة أمثلة محلية. رفع المحتوى الحقيقي يحتاج مسار ملفات وصلاحيات منفصلة.</div>
    </div>
  );
}

const settingsItems = [
  { id: "account", title: "الحساب", icon: "user" },
  { id: "general", title: "عام", icon: "settings" },
  { id: "appearance", title: "المظهر", icon: "image" },
  { id: "personalization", title: "التخصيص", icon: "wand" },
  { id: "knowledge", title: "المعرفة", icon: "book" },
  { id: "connectors", title: "التكاملات", icon: "plug" },
  { id: "skills", title: "المهارات", icon: "sparkle" },
  { id: "notifications", title: "الإشعارات", icon: "bell" },
  { id: "sharing", title: "المشاركة", icon: "users" },
  { id: "security", title: "الأمان", icon: "shield" },
  { id: "api", title: "API والمطور", icon: "code" },
];

function SettingsView({ settingsTab, onTabChange, onToast }) {
  const active = settingsItems.find((item) => item.id === settingsTab) || settingsItems[1];
  return (
    <div className="workspace-page settings-workspace-page">
      <PageHeader eyebrow="إعدادات مساحة العمل" title="الإعدادات" description="التحكم بالحساب والتجربة والتكاملات." />
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="أقسام الإعدادات">
          {settingsItems.map((item) => <button key={item.id} className={settingsTab === item.id ? "settings-nav-item settings-nav-active" : "settings-nav-item"} onClick={() => onTabChange(item.id)}><Icon name={item.icon} size={15} /><span>{item.title}</span></button>)}
        </nav>
        <section className="settings-content">
          <div className="settings-content-heading"><span className="settings-section-icon"><Icon name={active.icon} size={17} /></span><div><h2>{active.title}</h2><p>إعدادات تجريبية — لا تُحفَظ بعد إعادة التحميل.</p></div></div>
          {settingsTab === "appearance" ? (
            <div className="settings-choice-grid">{["داكن", "فاتح", "حسب النظام"].map((theme, index) => <button className={`theme-choice${index === 0 ? " theme-choice-active" : ""}`} key={theme} onClick={() => onToast(`المظهر «${theme}» غير مفعّل؛ تبقى المعاينة على الوضع الداكن.`)}><span className={`theme-preview theme-preview-${index}`} /><strong>{theme}</strong></button>)}</div>
          ) : settingsTab === "connectors" ? (
            <div className="settings-connectors"><p>اربط الخدمة أولًا، ثم اخترها داخل مهمة محددة.</p>{connectorOptions.map((connector) => <div className="settings-connector-row" key={connector.id}><span className="settings-connector-icon"><Icon name={connector.icon} size={16} /></span><span><strong>{connector.name}</strong><small>{connector.detail}</small></span><button className="outline-small-button" onClick={() => onToast(`${connector.name}: أضف إعداد المصادقة قبل الاتصال.`)}>إعداد</button></div>)}</div>
          ) : settingsTab === "personalization" ? (
            <div className="settings-form"><label>الاسم المفضل<input defaultValue="" placeholder="كيف يناديك Celia؟" /></label><label>الدور<input defaultValue="" placeholder="مثال: مطور منتجات" /></label><label>تعليمات عامة<textarea rows={4} placeholder="أضف تفضيلاتك للمحادثات المستقبلية…" /></label><button className="primary-small-button" onClick={() => onToast("التفضيلات لا تُحفَظ بعد إعادة التحميل؛ يلزم ربط تخزين خلفي.")}>حفظ التغييرات</button></div>
          ) : settingsTab === "knowledge" ? (
            <div className="knowledge-empty"><Icon name="book" size={22} /><strong>قاعدة معرفة مساحة العمل</strong><p>أضف قواعد دائمة أو روابط يحتاج الوكيل إلى الرجوع إليها.</p><button className="outline-small-button" onClick={() => onToast("تخزين المعرفة يحتاج API وقاعدة بيانات.")}>إضافة معرفة</button></div>
          ) : settingsTab === "skills" ? (
            <div className="settings-skills">{skillOptions.map((skill) => <div key={skill.command}><span className="skill-command">{skill.command}</span><span><strong>{skill.title}</strong><small>{skill.description}</small></span><span className="skill-status">معاينة</span></div>)}</div>
          ) : (
            <div className="settings-generic"><div><strong>{active.title} مساحة العمل</strong><p>يمكن إعداد هذا القسم بعد إضافة خدمة الحساب والتخزين المناسبة.</p></div><button className="outline-small-button" onClick={() => onToast(`إعداد ${active.title} سيحتاج خدمة خلفية.`)}>إدارة الإعداد</button></div>
          )}
        </section>
      </div>
    </div>
  );
}

export function WorkspaceContent({ view, tasks, projects, schedules, files, settingsTab, onSettingsTabChange, onOpenTask, onOpenProject, onToggleFavorite, onToggleSchedule, onOpenFile, onToast, onNewTask, onNavigateView }) {
  if (view === "tasks") return <TaskListView tasks={tasks} projects={projects} onOpenTask={onOpenTask} onToggleFavorite={onToggleFavorite} onToast={onToast} />;
  if (view === "projects") return <ProjectView projects={projects} tasks={tasks} onOpenProject={onOpenProject} onToast={onToast} />;
  if (view === "favorites") return <FavoritesView tasks={tasks} projects={projects} onOpenTask={onOpenTask} onOpenProject={onOpenProject} onToggleFavorite={onToggleFavorite} onToast={onToast} />;
  if (view === "scheduled") return <ScheduledView schedules={schedules} onToggle={onToggleSchedule} onToast={onToast} />;
  if (view === "library") return <LibraryView files={files} onOpenFile={onOpenFile} onToast={onToast} />;
  if (view === "settings") return <SettingsView settingsTab={settingsTab} onTabChange={onSettingsTabChange} onToast={onToast} />;
  return (
    <div className="home-dashboard">
      <div className="home-dashboard-heading"><div><div className="page-eyebrow-row"><span className="page-eyebrow">نظرة عامة</span><span className="page-demo-badge">معاينة محلية</span></div><h1>مساحة عملك</h1><p>تابع المهام والمشاريع التي تعمل عليها.</p></div><button className="primary-small-button" onClick={onNewTask}><Icon name="plus" size={15} />مهمة جديدة</button></div>
      <div className="overview-metrics"><div><span>المهام النشطة</span><strong>{tasks.filter((task) => task.status === "running").length}</strong><small>قيد التنفيذ الآن</small></div><div><span>المشاريع</span><strong>{projects.length}</strong><small>سياقات عمل</small></div><div><span>المفضلة</span><strong>{tasks.filter((task) => task.favorite).length}</strong><small>مهام محفوظة</small></div></div>
      <div className="home-dashboard-grid"><section><div className="section-subheading"><h2>المهام الأخيرة</h2><button onClick={() => onNavigateView("tasks")}>عرض الكل <Icon name="chevron" size={13} /></button></div><div className="workspace-task-list">{tasks.slice(0, 3).map((task) => <TaskCard key={task.id} task={task} projectName={projects.find((project) => project.id === task.projectId)?.name} onOpen={onOpenTask} onFavorite={onToggleFavorite} onMenu={() => {}} />)}</div></section><section><div className="section-subheading"><h2>المشاريع</h2><span>{projects.length}</span></div><div className="dashboard-projects">{projects.slice(0, 2).map((project) => <button key={project.id} onClick={() => onOpenProject(project)}><span className="project-icon"><Icon name="folder" size={15} /></span><span><strong>{project.name}</strong><small>{tasks.filter((task) => task.projectId === project.id).length} مهام · {project.files} ملفات</small></span><Icon name="chevron" size={14} /></button>)}</div></section></div>
    </div>
  );
}

export function SearchPalette({ open, query, onQueryChange, tasks, projects, files, onClose, onSelectTask, onSelectProject, onSelectFile }) {
  const inputRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setActiveIndex(0); }, [query]);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return { tasks: tasks.slice(0, 3), projects: projects.slice(0, 2), files: files.slice(0, 2) };
    return {
      tasks: tasks.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(term)),
      projects: projects.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(term)),
      files: files.filter((item) => `${item.name} ${item.source}`.toLowerCase().includes(term)),
    };
  }, [query, tasks, projects, files]);
  const entries = [
    ...results.tasks.map((item) => ({ kind: "task", item })),
    ...results.projects.map((item) => ({ kind: "project", item })),
    ...results.files.map((item) => ({ kind: "file", item })),
  ];
  function activate(entry) {
    if (!entry) return;
    if (entry.kind === "task") onSelectTask(entry.item);
    else if (entry.kind === "project") onSelectProject(entry.item);
    else onSelectFile(entry.item);
  }
  function handleSearchKeydown(event) {
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowDown" && entries.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % entries.length);
    } else if (event.key === "ArrowUp" && entries.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + entries.length) % entries.length);
    } else if (event.key === "Enter" && entries.length) {
      event.preventDefault();
      activate(entries[activeIndex]);
    }
  }
  if (!open) return null;
  const projectOffset = results.tasks.length;
  const fileOffset = projectOffset + results.projects.length;
  return (
    <div className="overlay-layer search-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="search-palette" role="dialog" aria-modal="true" aria-label="بحث شامل">
        <div className="search-input-wrap"><Icon name="search" size={19} /><input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={handleSearchKeydown} aria-controls="workspace-search-results" aria-activedescendant={entries[activeIndex] ? `search-result-${entries[activeIndex].kind}-${entries[activeIndex].item.id}` : undefined} aria-autocomplete="list" placeholder="ابحث عن مهمة أو مشروع أو ملف…" /><kbd>ESC</kbd></div>
        {!query.trim() && <div className="search-recent-label">ابدأ البحث أو اختر عنصرًا حديثًا</div>}
        <div className="search-results" id="workspace-search-results" role="listbox" aria-label="نتائج البحث">
          {results.tasks.length > 0 && <SearchGroup title="المهام" icon="list" items={results.tasks} getTitle={(item) => item.title} getDetail={(item) => item.description} onSelect={onSelectTask} onActivate={setActiveIndex} activeIndex={activeIndex} indexOffset={0} kind="task" />}
          {results.projects.length > 0 && <SearchGroup title="المشاريع" icon="folder" items={results.projects} getTitle={(item) => item.name} getDetail={(item) => item.description} onSelect={onSelectProject} onActivate={setActiveIndex} activeIndex={activeIndex} indexOffset={projectOffset} kind="project" />}
          {results.files.length > 0 && <SearchGroup title="الملفات" icon="fileText" items={results.files} getTitle={(item) => item.name} getDetail={(item) => item.source} onSelect={onSelectFile} onActivate={setActiveIndex} activeIndex={activeIndex} indexOffset={fileOffset} kind="file" />}
          {!results.tasks.length && !results.projects.length && !results.files.length && <EmptyState icon="search" title="لا توجد نتائج" detail="جرّب كلمات مختلفة." />}
        </div>
        <div className="search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> للتنقل</span><span><kbd>↵</kbd> لفتح النتيجة</span><span><kbd>ESC</kbd> للإغلاق</span></div>
      </section>
    </div>
  );
}

function SearchGroup({ title, icon, items, getTitle, getDetail, onSelect, onActivate, activeIndex, indexOffset, kind }) {
  return <div className="search-group" role="group" aria-label={title}><div className="search-group-title"><Icon name={icon} size={13} />{title}</div>{items.map((item, index) => {
    const globalIndex = indexOffset + index;
    return <button id={`search-result-${kind}-${item.id}`} key={item.id} role="option" aria-selected={activeIndex === globalIndex} className={`search-result${activeIndex === globalIndex ? " search-result-active" : ""}`} onMouseEnter={() => onActivate(globalIndex)} onClick={() => onSelect(item)}><span className="search-result-icon"><Icon name={icon} size={15} /></span><span><strong>{getTitle(item)}</strong><small>{getDetail(item)}</small></span><Icon name="chevron" size={13} /></button>;
  })}</div>;
}

function EmptyState({ icon, title, detail }) {
  return <div className="workspace-empty-state"><span><Icon name={icon} size={20} /></span><strong>{title}</strong><p>{detail}</p></div>;
}

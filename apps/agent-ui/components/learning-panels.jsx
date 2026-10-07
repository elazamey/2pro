"use client";

import Icon from "./icon.jsx";

export function createEmptyLearningSnapshot() {
  return {
    memories: [],
    knowledgeItems: [],
    relations: [],
    sources: [],
    experiences: [],
    evaluations: [],
    lessons: [],
    experiments: [],
    skills: [],
  };
}

const tabs = [
  { id: "memory", label: "الذاكرة", icon: "brain" },
  { id: "knowledge", label: "المعرفة", icon: "book" },
  { id: "learning", label: "التعلّم", icon: "sparkle" },
  { id: "skills", label: "المهارات", icon: "wand" },
];

const lifecycleLabels = {
  candidate: "مرشّح",
  observed: "مُلاحظ",
  learned: "مستخلص",
  testing: "قيد الاختبار",
  verified: "متحقق",
  approved: "موافق عليه",
  trusted: "موثوق",
  active: "نشط",
  stale: "قديم — مستبعد",
  superseded: "استُبدل",
  rejected: "مرفوض",
  archived: "مؤرشف",
  queued: "في الانتظار",
  indexing: "قيد الفهرسة",
  ready: "جاهز",
  failed: "فشل",
  deprecated: "متقادم",
  proposed: "مقترح",
  running: "قيد التشغيل",
  passed: "اجتاز الاختبار",
  cancelled: "أُلغي",
};

const kindLabels = {
  episodic: "تجربة",
  semantic: "حقيقة",
  procedural: "إجراء",
  preference: "تفضيل",
  fact: "حقيقة",
  rule: "قاعدة",
  procedure: "إجراء",
  example: "مثال",
  api_endpoint: "نقطة API",
  parameter: "معامل",
  schema: "مخطط بيانات",
  constraint: "قيد",
  warning: "تحذير",
  dependency: "اعتمادية",
  architecture: "معمارية",
  best_practice: "أفضل ممارسة",
  failure: "إخفاق",
  success: "نجاح",
  strategy: "استراتيجية",
};

const relationLabels = {
  uses: "يستخدم",
  depends_on: "يعتمد على",
  deployed_to: "منشور على",
  implements: "ينفّذ",
  derived_from: "مشتق من",
  supersedes: "يستبدل",
  contradicts: "يناقض",
  contains: "يحتوي",
  related_to: "مرتبط بـ",
};

function ScopeLabel({ scope }) {
  if (!scope) return null;
  const type = { task: "مهمة", project: "مشروع", user: "مستخدم", organization: "مؤسسة" }[scope.type] || scope.type;
  return <span className="cognition-scope" title={`${type}: ${scope.id}`}>{type} · {scope.id}</span>;
}

function Lifecycle({ value }) {
  if (!value) return null;
  return <span className={`cognition-lifecycle cognition-lifecycle-${value}`}>{lifecycleLabels[value] || value}</span>;
}

function EmptyPanel({ title, detail }) {
  return (
    <div className="cognition-empty-state">
      <span><Icon name="brain" size={20} /></span>
      <strong>{title}</strong>
      <p>{detail}</p>
      <small>لا تُعرض بيانات نموذجية هنا؛ تظهر السجلات عند وصول حدث صالح من خدمة الوكيل.</small>
    </div>
  );
}

function MemoryRecords({ records }) {
  if (!records.length) return <EmptyPanel title="لم تصل ذاكرة لهذه المهمة" detail="يرسل الوكيل سجلات الذاكرة التي استرجعها فقط، مع نطاقها ومصدرها." />;
  return <div className="cognition-record-list">{records.map((record) => (
    <article className="cognition-record-card" key={record.id}>
      <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="brain" size={15} /></span><div><strong>{record.title}</strong><small>{kindLabels[record.kind] || record.kind} · ثقة {Math.round(record.confidence * 100)}%</small></div><Lifecycle value={record.lifecycle} /></div>
      <p className="cognition-card-content">{record.content}</p>
      <div className="cognition-card-meta"><ScopeLabel scope={record.scope} /><span>المراجعة {record.revision}</span></div>
      <div className="cognition-provenance"><Icon name="shield" size={12} /><span>المصدر: {record.sourceRefs.map((source) => `${source.kind} / ${source.sourceId || source.taskId || source.uri}`).join("، ")}</span></div>
      <div className="cognition-evidence-stats"><span>{record.evidenceStats.observations} ملاحظة</span><span>{record.evidenceStats.successes} نجاح</span><span>{record.evidenceStats.failures} إخفاق</span><span>{record.evidenceStats.verificationCount} تحقق</span></div>
    </article>
  ))}</div>;
}

function KnowledgeRecords({ items, relations, sources }) {
  if (!items.length && !relations.length && !sources.length) return <EmptyPanel title="لم تُسترجع معرفة لهذه المهمة" detail="ستظهر الحقائق والإجراءات المستخرجة مع إصدار المصدر وموضع الاستشهاد." />;
  return <div className="cognition-record-list">
    {sources.map((source) => <article className="cognition-record-card cognition-source-card" key={`source-${source.id}`}>
      <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="book" size={15} /></span><div><strong>{source.title}</strong><small>مصدر {source.kind} · الإصدار {source.version || "غير محدد"}</small></div><Lifecycle value={source.status} /></div>
      <div className="cognition-card-meta"><ScopeLabel scope={source.scope} /><span>آخر جلب: {source.retrievedAt}</span></div>
      {source.canonicalUri && <div className="cognition-provenance"><Icon name="external" size={12} /><span dir="ltr">{source.canonicalUri}</span></div>}
    </article>)}
    {items.map((item) => <article className="cognition-record-card" key={item.id}>
      <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="fileText" size={15} /></span><div><strong>{item.title}</strong><small>{kindLabels[item.kind] || item.kind} · ثقة {Math.round(item.confidence * 100)}%</small></div><Lifecycle value={item.lifecycle} /></div>
      <p className="cognition-card-content">{item.statement}</p>
      <div className="cognition-card-meta"><ScopeLabel scope={item.scope} /><span>المصدر {item.sourceId} · {item.sourceVersion || "بلا إصدار"}</span></div>
      {item.citations.map((citation, index) => <div className="cognition-provenance" key={`${citation.sourceId}-${citation.locator}-${index}`}><Icon name="quote" size={12} /><span>{citation.locator}{citation.page !== undefined ? ` · صفحة ${citation.page}` : ""}{citation.quote ? ` — “${citation.quote}”` : ""}</span></div>)}
    </article>)}
    {relations.map((relation) => <article className="cognition-record-card cognition-relation-card" key={relation.id}>
      <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="layers" size={15} /></span><div><strong>علاقة معرفية</strong><small>ثقة {Math.round(relation.confidence * 100)}% · مراجعة {relation.revision}</small></div><Lifecycle value={relation.lifecycle} /></div>
      <div className="cognition-relation-graph" dir="ltr"><span>{relation.subject.kind}: {relation.subject.id}</span><b>{relationLabels[relation.predicate] || relation.predicate}</b><span>{relation.object.kind}: {relation.object.id}</span></div>
      <div className="cognition-card-meta"><ScopeLabel scope={relation.scope} /><span>{relation.sourceRefs.length} مصادر</span></div>
      <div className="cognition-provenance"><Icon name="shield" size={12} /><span>{relation.sourceRefs.map((source) => source.sourceId || source.taskId || source.uri).join("، ")}</span></div>
    </article>)}
  </div>;
}

function LearningRecords({ experiences, evaluations, lessons, experiments }) {
  const total = experiences.length + evaluations.length + lessons.length + experiments.length;
  if (!total) return <EmptyPanel title="لم يصل سجل تعلّم لهذه المهمة" detail="التجارب والتقييمات والدروس المرشّحة تظهر من أحداث الخدمة، لا من محاكاة الواجهة." />;
  return <div className="cognition-record-list">
    {lessons.map((lesson) => <article className="cognition-record-card cognition-lesson-card" key={`lesson-${lesson.id}`}>
      <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="sparkle" size={15} /></span><div><strong>{lesson.title}</strong><small>درس {kindLabels[lesson.kind] || lesson.kind} · ثقة {Math.round(lesson.confidence * 100)}%</small></div><Lifecycle value={lesson.lifecycle} /></div>
      <div className="cognition-trigger"><b>عند:</b> {lesson.trigger}</div>
      <p className="cognition-card-content"><b>التوصية:</b> {lesson.recommendation}</p>
      <div className="cognition-card-meta"><ScopeLabel scope={lesson.scope} /><span>{lesson.evidence.length} أدلة · مراجعة {lesson.revision}</span></div>
      {lesson.evidence.slice(0, 3).map((evidence) => <div className="cognition-provenance" key={evidence.id}><Icon name={evidence.outcome === "success" ? "check" : evidence.outcome === "failure" ? "x" : "info"} size={12} /><span>مهمة {evidence.taskId} · {evidence.strategy} · {evidence.summary}</span></div>)}
    </article>)}
    {experiences.map((experience) => <article className="cognition-record-card" key={`experience-${experience.id}`}>
      <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="list" size={15} /></span><div><strong>تجربة المهمة {experience.taskId}</strong><small>{experience.outcome} · التُقطت {experience.capturedAt}</small></div><span className="cognition-neutral-badge">Episodic</span></div>
      <p className="cognition-card-content">{experience.summary}</p>
      {!!experience.strategies.length && <div className="cognition-strategy-list">{experience.strategies.map((strategy, index) => <span key={`${strategy.name}-${index}`}>{strategy.name} · {strategy.outcome}</span>)}</div>}
    </article>)}
    {evaluations.map((evaluation) => <article className="cognition-record-card" key={`evaluation-${evaluation.id}`}>
      <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="checkCircle" size={15} /></span><div><strong>تقييم المهمة {evaluation.taskId}</strong><small>{evaluation.outcome} · المقيم {evaluation.evaluatorVersion}</small></div></div>
      <div className="cognition-score-list">{Object.entries(evaluation.scores).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).map(([key, value]) => <span key={key}><i style={{ width: `${value}%` }} /><b>{key === "policyCompliance" ? "السياسة" : key === "userSatisfaction" ? "رضا المستخدم" : key === "correctness" ? "الصحة" : key === "completeness" ? "الاكتمال" : "الكفاءة"}</b><strong>{Math.round(value)}%</strong></span>)}</div>
      {evaluation.policyFindings.length > 0 && <div className="cognition-warning">ملاحظات امتثال: {evaluation.policyFindings.join("، ")}</div>}
      {evaluation.userFeedback && <div className="cognition-provenance"><Icon name="message" size={12} /><span>ملاحظة المستخدم: {evaluation.userFeedback.usefulness}{evaluation.userFeedback.note ? ` — ${evaluation.userFeedback.note}` : ""}</span></div>}
    </article>)}
    {experiments.map((experiment) => <article className="cognition-record-card" key={`experiment-${experiment.id}`}>
      <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="layers" size={15} /></span><div><strong>اختبار {experiment.targetKind} · {experiment.targetId}</strong><small>بيئة {experiment.sandbox} · {experiment.summary}</small></div><Lifecycle value={experiment.status} /></div>
      <div className="cognition-experiment-counts"><span>خط أساس {experiment.baselineRuns}</span><span>تجربة {experiment.candidateRuns}</span><span>نجح {experiment.passedRuns}</span><span>أخفق {experiment.failedRuns}</span></div>
    </article>)}
  </div>;
}

function SkillRecords({ skills }) {
  if (!skills.length) return <EmptyPanel title="لا توجد مهارات مرشّحة من هذه المهمة" detail="لن تُنشأ أو تُفعّل مهارة تلقائيًا؛ يجب أن تصل من الخدمة مع الاختبارات والمصدر." />;
  return <div className="cognition-record-list">{skills.map((skill) => <article className="cognition-record-card" key={skill.id}>
    <div className="cognition-card-heading"><span className="cognition-card-icon"><Icon name="wand" size={15} /></span><div><strong>{skill.name}</strong><small>الإصدار {skill.version} · {skill.successRate === null ? "لا يوجد معدل نجاح" : `نجاح ${Math.round(skill.successRate * 100)}%`}</small></div><Lifecycle value={skill.lifecycle} /></div>
    <p className="cognition-card-content">{skill.description}</p>
    <div className="cognition-card-meta"><ScopeLabel scope={skill.scope} /><span>اختبارات {skill.testSummary.passed}/{skill.testSummary.total} · مراجعة {skill.revision}</span></div>
    <div className="cognition-provenance"><Icon name="shield" size={12} /><span>{skill.requiresApproval ? "تحتاج موافقة مالك قبل التفعيل." : skill.lifecycle === "active" ? "نشطة وفق حالة الخدمة." : "لا تُنفّذ مباشرة من هذه الواجهة."} المصادر: {skill.sourceRefs.map((source) => source.sourceId || source.taskId || source.uri).join("، ")}</span></div>
  </article>)}</div>;
}

export function LearningWorkspacePanel({ snapshot, activeTab, onTabChange }) {
  const counts = {
    memory: snapshot.memories.length,
    knowledge: snapshot.knowledgeItems.length + snapshot.relations.length + snapshot.sources.length,
    learning: snapshot.experiences.length + snapshot.evaluations.length + snapshot.lessons.length + snapshot.experiments.length,
    skills: snapshot.skills.length,
  };
  const tabContent = activeTab === "memory"
    ? <MemoryRecords records={snapshot.memories} />
    : activeTab === "knowledge"
      ? <KnowledgeRecords items={snapshot.knowledgeItems} relations={snapshot.relations} sources={snapshot.sources} />
      : activeTab === "learning"
        ? <LearningRecords experiences={snapshot.experiences} evaluations={snapshot.evaluations} lessons={snapshot.lessons} experiments={snapshot.experiments} />
        : <SkillRecords skills={snapshot.skills} />;
  const hasRecords = Object.values(counts).some((count) => count > 0);

  return (
    <section className="learning-workspace-panel" aria-label="لوحة الذاكرة والتعلّم">
      <div className="learning-panel-heading">
        <span className="learning-panel-symbol"><Icon name="brain" size={16} /></span>
        <div><h3>سياق الوكيل</h3><p>{hasRecords ? "سجلات صالحة وصلت من بث المهمة الحالي" : "بانتظار أحداث الذاكرة والمعرفة من الوكيل"}</p></div>
        <span className="learning-readonly-badge">v1 · قراءة</span>
      </div>
      <nav className="learning-subtabs" role="tablist" aria-label="أنواع السياق المعرفي">
        {tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "learning-subtab learning-subtab-active" : "learning-subtab"} onClick={() => onTabChange(tab.id)}><Icon name={tab.icon} size={12} /><span>{tab.label}</span><i>{counts[tab.id]}</i></button>)}
      </nav>
      <div className="learning-panel-content" role="tabpanel">{tabContent}</div>
      <div className="learning-panel-footer"><Icon name="lock" size={12} /><span>عرض للقراءة فقط؛ لا توجد API للحفظ أو الترقية أو النسيان موصولة بعد. لا تُعرض بيانات غير واردة من الخدمة.</span></div>
    </section>
  );
}

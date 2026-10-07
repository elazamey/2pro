"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icon.jsx";
import { parseExecutionEvent, parseSseFrame } from "../lib/agent-contract.mjs";
import { createEmptyLearningSnapshot, LearningWorkspacePanel } from "./learning-panels.jsx";
import {
  connectorOptions,
  initialFiles,
  initialProjects,
  initialSchedules,
  initialTasks,
  modeOptions,
  navigationItems,
  skillOptions,
  SearchPalette,
  WorkspaceContent,
} from "./workspace-panels.jsx";

const starterPrompts = [
  {
    icon: "rocket",
    title: "أطلق تطبيقًا",
    description: "جهّز المشروع للنشر على Vercel",
    prompt: "جهّز واجهة 2pro للنشر على Vercel، ووضّح لي خطوات التحقق قبل الإطلاق.",
  },
  {
    icon: "layers",
    title: "ابنِ واجهة جديدة",
    description: "حوّل فكرة إلى تجربة متكاملة",
    prompt: "ابنِ صفحة هبوط أنيقة لتطبيق SaaS لإدارة المشاريع، بتصميم داكن ومتجاوب.",
  },
  {
    icon: "github",
    title: "افحص مستودع GitHub",
    description: "اكتشف ما يحتاج إلى تحسين",
    prompt: "افحص مستودع GitHub وحدد أهم التحسينات المطلوبة قبل نشر الإصدار القادم.",
  },
];

const previewSteps = [
  { id: "understand", title: "فهم المطلوب", description: "تحويل فكرتك إلى هدف واضح", icon: "sparkle", status: "pending" },
  { id: "inspect", title: "فحص ملفات المشروع", description: "التعرّف على بنية التطبيق", icon: "folder", status: "pending" },
  { id: "prepare", title: "تجهيز الأدوات", description: "اختيار التكاملات المناسبة", icon: "plug", status: "pending" },
  { id: "verify", title: "التحقق من النتيجة", description: "مراجعة ما تم إنجازه", icon: "shield", status: "pending" },
];

const defaultActions = [
  { id: "payments", label: "تفعيل Stripe / Crypto", prompt: "جهّز تكامل دفع Stripe أو العملات الرقمية لهذا المشروع، وحدد ما يلزم قبل التفعيل.", icon: "creditCard", tone: "violet" },
  { id: "whatsapp", label: "أرسل تحديثًا عبر واتساب", prompt: "اكتب تحديثًا مختصرًا عن حالة المشروع وأرسله عبر واتساب بعد تأكيد المستلم.", icon: "phone", tone: "green" },
];

const exampleConversations = [
  { title: "إطلاق واجهة 2pro", prompt: starterPrompts[0].prompt, color: "violet" },
  { title: "صفحة منتج جديدة", prompt: starterPrompts[1].prompt, color: "blue" },
  { title: "مراجعة مستودع GitHub", prompt: starterPrompts[2].prompt, color: "green" },
];

const integrations = [
  { name: "Vercel", detail: "نشر التطبيقات", icon: "rocket" },
  { name: "Stripe / Crypto", detail: "المدفوعات", icon: "creditCard" },
  { name: "WhatsApp", detail: "الرسائل والتنبيهات", icon: "phone" },
  { name: "Telegram", detail: "الدردشة والتنبيهات", icon: "telegram" },
];

function makeTaskSteps(prompt) {
  const isDeploy = /نشر|انشر|إطلاق|اطلق|vercel|deploy|launch/i.test(prompt);
  return [
    { id: "understand", title: "تحليل المطلوب", description: "ترتيب الهدف إلى خطوات قابلة للتنفيذ", icon: "sparkle", status: "pending" },
    { id: "inspect", title: "فحص المشروع", description: "مراجعة الملفات والإعدادات ذات الصلة", icon: "folder", status: "pending" },
    { id: "prepare", title: isDeploy ? "تجهيز ملفات النشر" : "تنفيذ التغييرات المطلوبة", description: "إعداد التعديلات والتكاملات اللازمة", icon: "wand", status: "pending" },
    { id: "secure", title: isDeploy ? "إضافة التوقيع الرقمي" : "مراجعة الأمان", description: isDeploy ? "تأمين ملفات الإصدار والتحقق من التوقيع" : "التحقق من الإعدادات والأسرار", icon: "shield", status: "pending" },
    { id: "verify", title: isDeploy ? "النشر على Vercel" : "فحص النتيجة", description: isDeploy ? "متابعة خطوة الإطلاق والتحقق من حالتها" : "تأكيد اكتمال المهمة وتجهيز الخطوة التالية", icon: isDeploy ? "rocket" : "checkCircle", status: "pending" },
  ];
}

function normalizeSteps(items) {
  if (!Array.isArray(items)) return [];
  const allowedStatuses = new Set(["pending", "running", "done", "error"]);
  return items.slice(0, 8).map((item, index) => ({
    id: String(item?.id || `step-${index + 1}`),
    title: String(item?.title || item?.label || `الخطوة ${index + 1}`).slice(0, 100),
    description: String(item?.description || item?.detail || "").slice(0, 180),
    icon: ["sparkle", "folder", "plug", "shield", "rocket", "checkCircle", "wand"].includes(item?.icon) ? item.icon : "sparkle",
    status: allowedStatuses.has(item?.status) ? item.status : "pending",
  }));
}

function normalizeActions(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 3).map((item, index) => ({
    id: String(item?.id || `action-${index + 1}`),
    label: String(item?.label || item?.title || "متابعة المهمة").slice(0, 60),
    prompt: String(item?.prompt || item?.label || item?.title || "تابع المهمة السابقة").slice(0, 500),
    icon: item?.icon === "phone" ? "phone" : item?.icon === "creditCard" ? "creditCard" : "arrow",
    tone: item?.tone === "green" ? "green" : "violet",
  }));
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function upsertById(items, item, limit = 50) {
  return [item, ...items.filter((existing) => existing.id !== item.id)].slice(0, limit);
}

async function consumeAgentStream(response, onEvent) {
  if (!response.body) throw new Error("اتصال البث غير متاح في هذا المتصفح.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const parsed = parseSseFrame(frame);
      if (parsed && onEvent(parsed.event, parsed.data, parsed.id) === false) {
        await reader.cancel();
        return;
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const parsed = parseSseFrame(buffer);
    if (parsed && onEvent(parsed.event, parsed.data, parsed.id) === false) await reader.cancel();
  }
}

function demoReply(prompt) {
  const isDeploy = /نشر|انشر|إطلاق|اطلق|vercel|deploy|launch/i.test(prompt);
  if (isDeploy) {
    return "جهّزت لك مسارًا واضحًا للإطلاق: مراجعة ملفات المشروع، التحقق من إعدادات الأمان، ثم تجهيز النشر على Vercel. هذه معاينة تفاعلية فقط؛ لم يتم رفع ملفات أو تنفيذ نشر فعلي. بعد توصيل Celia Agent وأدوات MCP، يمكن للوكيل تنفيذ الخطوات وإرجاع نتيجة حقيقية هنا.";
  }
  return "حلّلت طلبك وحوّلته إلى خطوات عمل مرتبة. هذه معاينة تفاعلية للواجهة، لذلك لم تُجرَ تغييرات فعلية على ملفات أو خدمات خارجية. وصّل Celia Agent وأدوات MCP لتنفيذ المهمة وإظهار نتائجها الحقيقية.";
}

function StepRow({ step, index, isLast }) {
  const status = step.status || "pending";
  return (
    <li className={`step-row step-${status}`}>
      <div className="step-rail" aria-hidden="true">
        <span className="step-node">
          {status === "done" ? <Icon name="check" size={14} /> : status === "running" ? <span className="mini-spinner" /> : <span>{String(index + 1).padStart(2, "0")}</span>}
        </span>
        {!isLast && <span className="step-connector" />}
      </div>
      <div className="step-copy">
        <div className="step-title-line">
          <span className="step-title">{step.title}</span>
          {status === "running" && <span className="step-live-label">جارٍ الآن</span>}
          {status === "done" && <Icon name="checkCircle" size={14} className="step-done-icon" />}
        </div>
        <p>{step.description}</p>
      </div>
    </li>
  );
}

function executionEventTitle(event) {
  const payload = event.payload;
  if (event.type === "task.started") return "بدأت المهمة";
  if (event.type === "task.planning") return "أُعدّت خطة التنفيذ";
  if (event.type === "tool.started") return `بدأت أداة: ${payload.toolName}`;
  if (event.type === "tool.progress") return "تقدم الأداة";
  if (event.type === "tool.output") return "نتيجة الأداة";
  if (event.type === "approval.required") return "إجراء يحتاج مراجعة";
  if (event.type === "artifact.created") return "أُضيف مخرج";
  if (event.type === "task.completed") return "اكتملت المهمة";
  if (event.type === "task.failed") return "تعذّر إكمال المهمة";
  if (event.type === "memory.retrieved") return "استُرجعت ذاكرة";
  if (event.type === "knowledge.retrieved") return "استُرجعت معرفة";
  if (event.type === "knowledge.relations_retrieved") return "استُرجعت علاقات معرفية";
  if (event.type === "knowledge.source.consulted") return "رُوجع مصدر موثّق";
  if (event.type === "learning.experience.recorded") return "سُجلت تجربة";
  if (event.type === "learning.evaluation.completed") return "اكتمل تقييم النتيجة";
  if (event.type === "learning.lesson.candidate") return "درس مرشّح للمراجعة";
  if (event.type === "learning.lesson.status_changed") return "تحدّثت حالة درس";
  if (event.type === "learning.experiment.completed") return "اكتمل اختبار معزول";
  if (event.type === "skill.candidate") return "مهارة مرشّحة للمراجعة";
  if (event.type === "skill.status_changed") return "تحدّثت حالة مهارة";
  return event.type;
}

function executionEventDetail(event) {
  const payload = event.payload;
  if (event.type === "task.started") return `المهمة ${event.taskId}`;
  if (event.type === "task.planning") return `${payload.steps.length} خطوات في الخطة`;
  if (event.type === "tool.started") return payload.description || payload.toolCallId;
  if (event.type === "tool.progress") return payload.message || `معرّف الأداة: ${payload.toolCallId}`;
  if (event.type === "tool.output") return payload.summary || `معرّف الأداة: ${payload.toolCallId}`;
  if (event.type === "approval.required") return payload.reason || payload.action;
  if (event.type === "artifact.created") return payload.artifact.name;
  if (event.type === "task.completed") return payload.summary || "أرسل الوكيل حدث الإكمال.";
  if (event.type === "task.failed") return payload.error.message;
  if (event.type === "memory.retrieved") return `${payload.memories.length} سجلات ذاكرة · طلب ${payload.queryId}`;
  if (event.type === "knowledge.retrieved") return `${payload.items.length} عناصر معرفة · طلب ${payload.queryId}`;
  if (event.type === "knowledge.relations_retrieved") return `${payload.relations.length} علاقات موثقة · طلب ${payload.queryId}`;
  if (event.type === "knowledge.source.consulted") return `${payload.source.title} · ${payload.source.version || "بلا إصدار"}`;
  if (event.type === "learning.experience.recorded") return `${payload.experience.outcome} · المهمة ${payload.experience.taskId}`;
  if (event.type === "learning.evaluation.completed") return `نتيجة ${payload.evaluation.outcome} · امتثال ${payload.evaluation.scores.policyCompliance}%`;
  if (event.type === "learning.lesson.candidate" || event.type === "learning.lesson.status_changed") return `${payload.lesson.title} · ${payload.lesson.lifecycle}`;
  if (event.type === "learning.experiment.completed") return `${payload.experiment.status} · ${payload.experiment.passedRuns}/${payload.experiment.candidateRuns} تجارب ناجحة`;
  if (event.type === "skill.candidate" || event.type === "skill.status_changed") return `${payload.skill.name} · ${payload.skill.lifecycle} · ${payload.skill.version}`;
  return "";
}

function executionEventIcon(type) {
  if (type.startsWith("task.")) return type === "task.failed" ? "x" : type === "task.completed" ? "check" : "sparkle";
  if (type === "approval.required") return "shield";
  if (type === "artifact.created") return "fileText";
  if (type.startsWith("memory.")) return "brain";
  if (type.startsWith("knowledge.")) return "book";
  if (type.startsWith("learning.")) return "sparkle";
  if (type.startsWith("skill.")) return "wand";
  return "plug";
}

function AssistantAvatar({ small = false }) {
  return (
    <span className={`assistant-avatar${small ? " assistant-avatar-small" : ""}`} aria-hidden="true">
      <Icon name="sparkle" size={small ? 15 : 19} />
    </span>
  );
}

export default function AgentWorkspace() {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(() => makeId());
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState([]);
  const [runState, setRunState] = useState("idle");
  const [agentMode, setAgentMode] = useState("checking");
  const [activeView, setActiveView] = useState("chat");
  const [tasks, setTasks] = useState(initialTasks);
  const [projects, setProjects] = useState(initialProjects);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [files, setFiles] = useState(initialFiles);
  const [settingsTab, setSettingsTab] = useState("general");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activePanelTab, setActivePanelTab] = useState("activity");
  const [activeCognitionTab, setActiveCognitionTab] = useState("memory");
  const [learningSnapshot, setLearningSnapshot] = useState(createEmptyLearningSnapshot);
  const [connectorMenuOpen, setConnectorMenuOpen] = useState(false);
  const [selectedConnectors, setSelectedConnectors] = useState([]);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [learnFromTask, setLearnFromTask] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState("agent");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [artifactPreview, setArtifactPreview] = useState(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskTitleDraft, setTaskTitleDraft] = useState("");
  const [taskPromptDraft, setTaskPromptDraft] = useState("");
  const [taskProjectDraft, setTaskProjectDraft] = useState(initialProjects[0]?.id || "");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLinkSelected, setShareLinkSelected] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [pendingApproval, setPendingApproval] = useState(null);
  const [executionEvents, setExecutionEvents] = useState([]);
  const [telegramBotUrl, setTelegramBotUrl] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [streamingReply, setStreamingReply] = useState("");
  const scrollAreaRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const shareUrlInputRef = useRef(null);
  const lastEventSequenceRef = useRef(0);
  const executionTaskIdRef = useRef("");
  const executionGenerationRef = useRef(0);
  const toastTimerRef = useRef(null);

  const isRunning = runState === "running";
  const hasConversation = messages.length > 0;
  const conversationTitle = hasConversation
    ? (messages.find((message) => message.role === "user")?.text || "محادثة جديدة").slice(0, 34)
    : "محادثة جديدة";
  const activeViewTitle = navigationItems.find((item) => item.id === activeView)?.label || "مساحة العمل";

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/chat", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (active) setAgentMode(data.mode === "live" ? "live" : "demo");
      })
      .catch(() => {
        if (active) setAgentMode("demo");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/telegram", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (active && data.ready && typeof data.botUrl === "string") setTelegramBotUrl(data.botUrl);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function handleGlobalKeydown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchQuery("");
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setConnectorMenuOpen(false);
        setSkillMenuOpen(false);
        setModeMenuOpen(false);
        setTaskDialogOpen(false);
        setSelectedTask(null);
        setSelectedProject(null);
        setArtifactPreview(null);
        setShareOpen(false);
      }
    }
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  useEffect(() => {
    if (scrollAreaRef.current && activeView === "chat") {
      scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, runState, streamingReply, activeView]);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  function showToast(text) {
    setToast(text);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 3200);
  }

  function navigateView(view) {
    setActiveView(view);
    setMobileMenuOpen(false);
    setConnectorMenuOpen(false);
    setSkillMenuOpen(false);
    setModeMenuOpen(false);
  }

  function openTask(task) {
    if (!task) {
      setTaskTitleDraft("");
      setTaskPromptDraft("");
      setTaskProjectDraft(selectedProject?.id || projects[0]?.id || "");
      setTaskDialogOpen(true);
      return;
    }
    setSelectedTask(task);
  }

  function createTask() {
    const title = taskTitleDraft.trim();
    if (!title) return;
    const task = {
      id: `task-${makeId()}`,
      title,
      description: taskPromptDraft.trim() || "مهمة جديدة في مساحة العمل.",
      prompt: taskPromptDraft.trim() || title,
      status: "queued",
      updated: "الآن",
      projectId: taskProjectDraft || projects[0]?.id || null,
      favorite: false,
    };
    setTasks((current) => [task, ...current]);
    setTaskDialogOpen(false);
    setTaskTitleDraft("");
    setTaskPromptDraft("");
    navigateView("tasks");
    showToast("أُضيفت المهمة إلى بيانات هذه الجلسة فقط؛ لا يوجد تخزين دائم موصول.");
  }

  function toggleFavorite(taskId) {
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, favorite: !task.favorite } : task));
  }

  function toggleProjectFavorite(projectId) {
    setProjects((current) => current.map((project) => project.id === projectId ? { ...project, favorite: !project.favorite } : project));
  }

  function toggleSchedule(scheduleId) {
    setSchedules((current) => current.map((schedule) => schedule.id === scheduleId ? { ...schedule, enabled: !schedule.enabled } : schedule));
    showToast("تغيّر التبديل في المعاينة فقط؛ لا يعمل مجدول خلفي الآن.");
  }

  function handleTaskRun(task) {
    if (!task) return;
    setSelectedTask(null);
    setSelectedMode("agent");
    navigateView("chat");
    setInput(task.prompt || task.title);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
    showToast("راجع نص المهمة ثم أرسله لبدء تشغيل جديد.");
  }

  function handleShareCopy() {
    if (!shareUrlInputRef.current) return;
    shareUrlInputRef.current.focus();
    shareUrlInputRef.current.select();
    setShareLinkSelected(true);
    showToast("حُدّد الرابط؛ انسخه يدويًا باستخدام Ctrl+C أو ⌘C. لا تتم مشاركة الصلاحيات.");
  }

  function toggleConnector(connectorId) {
    setSelectedConnectors((current) => current.includes(connectorId)
      ? current.filter((id) => id !== connectorId)
      : [...current, connectorId]);
  }

  function toggleSkill(skillId) {
    setSelectedSkills((current) => current.includes(skillId)
      ? current.filter((id) => id !== skillId)
      : [...current, skillId]);
  }

  function openTaskFromSearch(task) {
    setSearchOpen(false);
    setSearchQuery("");
    navigateView("tasks");
    setSelectedTask(task);
  }

  function openProjectFromSearch(project) {
    setSearchOpen(false);
    setSearchQuery("");
    navigateView("projects");
    setSelectedProject(project);
  }

  function openFileFromSearch(file) {
    setSearchOpen(false);
    setSearchQuery("");
    setArtifactPreview(file);
  }

  function recordExecutionEvent(event) {
    setExecutionEvents((current) => [...current, event].slice(-50));
  }

  function upsertExecutionStep(step) {
    setSteps((current) => {
      const existing = current.find((item) => item.id === step.id);
      if (!existing) return [...current, step].slice(-8);
      return current.map((item) => item.id === step.id ? { ...item, ...step } : item);
    });
  }

  async function animateDemoSteps(prompt, shouldContinue = () => true) {
    const taskSteps = makeTaskSteps(prompt);
    for (let current = 0; current < taskSteps.length; current += 1) {
      if (!shouldContinue()) return false;
      setSteps(taskSteps.map((step, index) => ({
        ...step,
        status: index < current ? "done" : index === current ? "running" : "pending",
      })));
      await wait(current === 0 ? 480 : 570);
    }
    if (!shouldContinue()) return false;
    setSteps(taskSteps.map((step) => ({ ...step, status: "done" })));
    return true;
  }

  async function sendPrompt(rawText) {
    const rawPrompt = rawText.trim();
    if (!rawPrompt || isRunning) return;
    const runGeneration = executionGenerationRef.current + 1;
    executionGenerationRef.current = runGeneration;
    const isCurrentRun = () => executionGenerationRef.current === runGeneration;
    const selectedModeOption = modeOptions.find((option) => option.id === selectedMode);
    const modeInstruction = selectedModeOption && selectedMode !== "agent"
      ? `أسلوب العمل المطلوب: ${selectedModeOption.name} — ${selectedModeOption.detail}.`
      : "";
    const skillInstructions = skillOptions
      .filter((skill) => selectedSkills.includes(skill.command))
      .map((skill) => `مهارة مقترحة: ${skill.title} — ${skill.description}.`);
    const prompt = [modeInstruction, ...skillInstructions, rawPrompt].filter(Boolean).join("\n\n");
    const connectorNotice = selectedConnectors.length > 0;
    const attachmentNotice = pendingFiles.length > 0;
    const learningConsent = learnFromTask;

    setInput("");
    setSelectedSkills([]);
    setLearnFromTask(false);
    setSelectedConnectors([]);
    setPendingFiles([]);
    setPendingApproval(null);
    setExecutionEvents([]);
    setLearningSnapshot(createEmptyLearningSnapshot());
    setActiveCognitionTab("memory");
    lastEventSequenceRef.current = 0;
    executionTaskIdRef.current = "";
    setStreamingReply("");
    setMobileMenuOpen(false);
    if (connectorNotice || attachmentNotice) {
      const notices = [];
      if (connectorNotice) notices.push("اختيارات الموصلات محلية ولم تُرسل إلى خدمة خارجية");
      if (attachmentNotice) notices.push("أُرسل النص فقط، ولم يُرفع محتوى الملفات");
      showToast(`${notices.join("؛ ")}.`);
    }
    setMessages((current) => [...current, { id: makeId(), role: "user", text: prompt }]);
    setSteps(makeTaskSteps(prompt).map((step, index) => ({ ...step, status: index === 0 ? "running" : "pending" })));
    setRunState("running");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          message: prompt,
          conversationId,
          learningConsent,
          history: messages.slice(-20).map((message) => ({ role: message.role, content: message.text })),
        }),
      });
      if (!isCurrentRun()) return;
      const isEventStream = response.headers.get("content-type")?.includes("text/event-stream");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "تعذّر الاتصال بالوكيل.");
      }

      if (isEventStream) {
        setAgentMode("live");
        let streamText = "";
        let streamActions = [];
        let streamConversationId = "";
        let streamError = "";

        await consumeAgentStream(response, (eventName, rawData, sseId) => {
          if (!isCurrentRun()) return false;
          const data = rawData && typeof rawData === "object" ? rawData : {};
          const eventType = data.type || eventName;
          const executionEvent = parseExecutionEvent(eventName, data);
          if (executionEvent) {
            if (sseId !== executionEvent.id) throw new Error("معرّف SSE لا يطابق معرّف حدث التنفيذ.");
            if (executionTaskIdRef.current && executionTaskIdRef.current !== executionEvent.taskId) {
              throw new Error("تغيّر معرّف المهمة داخل بث التنفيذ.");
            }
            if (executionEvent.sequence <= lastEventSequenceRef.current) return;
            if (executionEvent.sequence !== lastEventSequenceRef.current + 1) {
              throw new Error("تسلسل أحداث التنفيذ غير مكتمل.");
            }
            executionTaskIdRef.current = executionEvent.taskId;
            lastEventSequenceRef.current = executionEvent.sequence;
            const { payload } = executionEvent;
            recordExecutionEvent(executionEvent);
            if (executionEvent.type === "task.started") {
              setRunState("running");
            } else if (executionEvent.type === "task.planning") {
              setSteps(normalizeSteps(payload.steps.map((step) => ({ ...step, icon: "sparkle" }))));
            } else if (executionEvent.type === "tool.started") {
              upsertExecutionStep({
                id: payload.toolCallId,
                title: payload.title,
                description: payload.description,
                icon: "plug",
                status: "running",
              });
            } else if (executionEvent.type === "tool.progress") {
              upsertExecutionStep({
                id: payload.toolCallId,
                title: payload.toolCallId,
                description: payload.message || "الأداة قيد التنفيذ.",
                icon: "plug",
                status: "running",
              });
            } else if (executionEvent.type === "tool.output") {
              upsertExecutionStep({
                id: payload.toolCallId,
                title: payload.toolCallId,
                description: payload.summary || "اكتمل ناتج الأداة.",
                icon: "plug",
                status: "done",
              });
            } else if (executionEvent.type === "approval.required") {
              setPendingApproval({
                id: payload.approvalId,
                title: payload.action,
                detail: payload.reason || "راجع أثر الإجراء قبل اتخاذ القرار.",
                decision: "pending",
              });
            } else if (executionEvent.type === "artifact.created") {
              const artifact = payload.artifact;
              const fileType = artifact.kind === "image" ? "image" : artifact.kind === "code" || artifact.kind === "data" ? "code" : "document";
              const sizeLabel = Number.isFinite(artifact.sizeBytes) ? ` · ${artifact.sizeBytes.toLocaleString("en-US")} B` : "";
              setFiles((current) => [{
                id: artifact.id,
                name: artifact.name,
                type: fileType,
                detail: `${artifact.mimeType || artifact.kind}${sizeLabel}`,
                updated: "الآن",
                source: "مخرج الوكيل",
              }, ...current.filter((file) => file.id !== artifact.id)].slice(0, 100));
            } else if (executionEvent.type === "task.completed") {
              setRunState("complete");
              if (!streamText && payload.summary) {
                streamText = payload.summary;
                setStreamingReply(streamText);
              }
              if (payload.steps) setSteps(normalizeSteps(payload.steps));
              else setSteps((current) => current.map((step) => ({ ...step, status: "done" })));
            } else if (executionEvent.type === "task.failed") {
              streamError = payload.error.message;
              return false;
            } else if (executionEvent.type === "memory.retrieved") {
              setLearningSnapshot((current) => ({ ...current, memories: payload.memories }));
            } else if (executionEvent.type === "knowledge.retrieved") {
              setLearningSnapshot((current) => ({ ...current, knowledgeItems: payload.items }));
            } else if (executionEvent.type === "knowledge.relations_retrieved") {
              setLearningSnapshot((current) => ({ ...current, relations: payload.relations }));
            } else if (executionEvent.type === "knowledge.source.consulted") {
              setLearningSnapshot((current) => ({ ...current, sources: upsertById(current.sources, payload.source) }));
            } else if (executionEvent.type === "learning.experience.recorded") {
              setLearningSnapshot((current) => ({ ...current, experiences: upsertById(current.experiences, payload.experience) }));
            } else if (executionEvent.type === "learning.evaluation.completed") {
              setLearningSnapshot((current) => ({ ...current, evaluations: upsertById(current.evaluations, payload.evaluation) }));
            } else if (executionEvent.type === "learning.lesson.candidate" || executionEvent.type === "learning.lesson.status_changed") {
              setLearningSnapshot((current) => ({ ...current, lessons: upsertById(current.lessons, payload.lesson) }));
            } else if (executionEvent.type === "learning.experiment.completed") {
              setLearningSnapshot((current) => ({ ...current, experiments: upsertById(current.experiments, payload.experiment) }));
            } else if (executionEvent.type === "skill.candidate" || executionEvent.type === "skill.status_changed") {
              setLearningSnapshot((current) => ({ ...current, skills: upsertById(current.skills, payload.skill) }));
            }
            return;
          }
          if (eventType === "error") {
            streamError = String(data.error || data.message || "انقطع بث التحديثات من الوكيل.");
            return false;
          } else if (eventType === "steps" && Array.isArray(data.steps)) {
            setSteps(normalizeSteps(data.steps));
          } else if (eventType === "step") {
            const nextStep = normalizeSteps([data.step || data])[0];
            if (nextStep) {
              setSteps((current) => {
                const existingIndex = current.findIndex((step) => step.id === nextStep.id);
                if (existingIndex < 0) return [...current, nextStep].slice(0, 8);
                return current.map((step) => step.id === nextStep.id ? nextStep : step);
              });
            }
          } else if (eventType === "reply") {
            if (typeof data.delta === "string") streamText += data.delta;
            else if (typeof data.text === "string") streamText = data.text;
            else if (typeof data.reply === "string") streamText = data.reply;
            setStreamingReply(streamText);
          } else if (["approval", "approval_required", "permission"].includes(eventType)) {
            setPendingApproval({
              id: String(data.id || makeId()),
              title: String(data.title || data.action || "إجراء خارجي يحتاج مراجعة").slice(0, 120),
              detail: String(data.detail || data.reason || "راجع أثر الإجراء قبل اتخاذ القرار.").slice(0, 280),
              decision: "pending",
            });
          } else if (eventType === "actions" && Array.isArray(data.actions)) {
            streamActions = normalizeActions(data.actions);
          } else if (eventType === "done") {
            if (typeof data.reply === "string") streamText = data.reply;
            if (Array.isArray(data.steps)) setSteps(normalizeSteps(data.steps));
            if (Array.isArray(data.actions)) streamActions = normalizeActions(data.actions);
            if (typeof data.conversationId === "string" && data.conversationId.length <= 160) streamConversationId = data.conversationId;
            setStreamingReply(streamText);
          }
        });
        if (!isCurrentRun()) return;
        if (streamError) throw new Error(streamError);

        if (streamConversationId) setConversationId(streamConversationId);
        setMessages((current) => [...current, {
          id: makeId(), role: "assistant", text: streamText || "اكتملت المهمة.", actions: streamActions, demo: false,
        }]);
        setStreamingReply("");
      } else {
        const data = await response.json().catch(() => ({}));
        if (!isCurrentRun()) return;
        if (data.mode === "demo") {
          setAgentMode("demo");
          if (!(await animateDemoSteps(prompt, isCurrentRun))) return;
          const actions = normalizeActions(defaultActions);
          setMessages((current) => [...current, {
            id: makeId(),
            role: "assistant",
            text: demoReply(prompt),
            actions,
            demo: true,
          }]);
          if (learningConsent) showToast("وضع المعاينة لا يتصل بخدمة تعلّم؛ لم تُسجّل أي تجربة أو ذاكرة.");
        } else {
          setAgentMode("live");
          if (typeof data.conversationId === "string" && data.conversationId.length <= 160) setConversationId(data.conversationId);
          const liveSteps = normalizeSteps(data.steps);
          setSteps(liveSteps.length ? liveSteps : makeTaskSteps(prompt).map((step) => ({ ...step, status: "done" })));
          const actions = normalizeActions(data.actions);
          const reply = String(data.reply || data.response || data.message || "اكتملت المهمة.").slice(0, 6000);
          setMessages((current) => [...current, {
            id: makeId(),
            role: "assistant",
            text: reply,
            actions,
            demo: false,
          }]);
        }
      }
      if (!isCurrentRun()) return;
      setRunState("complete");
    } catch (error) {
      if (!isCurrentRun()) return;
      setAgentMode("error");
      setRunState("error");
      setSteps((current) => current.map((step) => step.status === "running" ? { ...step, status: "error" } : step));
      setStreamingReply("");
      setMessages((current) => [...current, {
        id: makeId(),
        role: "assistant",
        text: `لم أتمكن من إكمال الطلب: ${error.message || "حدث خطأ غير متوقع."} يمكنك المحاولة مجددًا بعد التحقق من اتصال Celia Agent.`,
        actions: [],
        demo: false,
      }]);
    }
  }

  function startNewChat() {
    executionGenerationRef.current += 1;
    setMessages([]);
    setConversationId(makeId());
    setInput("");
    setSteps([]);
    setExecutionEvents([]);
    setLearningSnapshot(createEmptyLearningSnapshot());
    setActiveCognitionTab("memory");
    setStreamingReply("");
    lastEventSequenceRef.current = 0;
    executionTaskIdRef.current = "";
    setRunState("idle");
    setPendingApproval(null);
    setSelectedSkills([]);
    setLearnFromTask(false);
    setSelectedConnectors([]);
    setPendingFiles([]);
    setActivePanelTab("activity");
    setActiveView("chat");
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function useExample(prompt) {
    setInput(prompt);
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const visibleSteps = steps.length ? steps : previewSteps;
  const completedCount = steps.filter((step) => step.status === "done").length;
  const progress = steps.length
    ? Math.round(((completedCount + (isRunning ? 0.12 : 0)) / steps.length) * 100)
    : 0;
  const runLabel = runState === "running"
    ? "قيد التنفيذ"
    : runState === "complete"
      ? "اكتمل"
      : runState === "error"
        ? "يحتاج مراجعة"
        : "بانتظار طلبك";

  return (
    <div className="app-shell">
      {mobileMenuOpen && <button className="mobile-backdrop" aria-label="إغلاق القائمة" onClick={() => setMobileMenuOpen(false)} />}

      <aside className={`sidebar${mobileMenuOpen ? " sidebar-open" : ""}`}>
        <div className="brand-row">
          <span className="brand-mark"><Icon name="sparkle" size={21} /></span>
          <div className="brand-copy">
            <span className="brand-name">celia<span className="brand-period">.</span></span>
            <span className="brand-caption">مساحة عمل ذكية</span>
          </div>
          <button className="icon-button sidebar-close" aria-label="إغلاق القائمة" onClick={() => setMobileMenuOpen(false)}>
            <Icon name="x" />
          </button>
        </div>

        <button className="new-chat-button" onClick={startNewChat}>
          <Icon name="plus" size={18} />
          <span>محادثة جديدة</span>
        </button>

        <div className="sidebar-section-label">مساحة العمل</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">2</span>
          <span className="workspace-switch-copy"><strong>2pro Workspace</strong><small>{isHydrated ? "معاينة محلية" : "مساحة شخصية"}</small></span>
          <Icon name="down" size={15} className="workspace-chevron" />
        </div>

        <button className="sidebar-search-trigger" onClick={() => { setSearchQuery(""); setSearchOpen(true); setMobileMenuOpen(false); }}>
          <Icon name="search" size={16} /><span>بحث شامل</span><kbd>⌘ K</kbd>
        </button>
        <nav className="workspace-nav" aria-label="التنقل في مساحة العمل">
          {navigationItems.map((item) => (
            <button key={item.id} className={`workspace-nav-item${activeView === item.id ? " workspace-nav-active" : ""}`} aria-current={activeView === item.id ? "page" : undefined} onClick={() => navigateView(item.id)}>
              <Icon name={item.icon} size={16} /><span>{item.label}</span>
              {item.id === "tasks" && <small>{tasks.length}</small>}
              {item.id === "favorites" && <small>{tasks.filter((task) => task.favorite).length + projects.filter((project) => project.favorite).length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section-heading">
          <span>ابدأ من مثال</span>
          <button className="icon-button mini-icon-button" aria-label="محادثة جديدة" onClick={startNewChat}><Icon name="plus" size={15} /></button>
        </div>
        <div className="conversation-list">
          {exampleConversations.map((conversation) => (
            <button className="conversation-link" key={conversation.title} onClick={() => { navigateView("chat"); useExample(conversation.prompt); }}>
              <span className={`conversation-dot dot-${conversation.color}`} />
              <span className="conversation-title">{conversation.title}</span>
              <span className="conversation-time">مثال</span>
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <div className="tip-icon"><Icon name="wand" size={16} /></div>
            <div><strong>فكرتك، بخطوة واحدة</strong><span>اطلب. راقب. أطلق.</span></div>
            <Icon name="arrow" size={14} className="tip-arrow" />
          </div>
          <div className="profile-card">
            <div className="profile-avatar">م</div>
            <div className="profile-copy"><strong>مساحة عملك</strong><span>{isHydrated ? "وضع المعاينة · مجاني" : "الخطة المجانية"}</span></div>
            <button className="icon-button profile-menu" aria-label="المزيد" onClick={() => showToast("إعدادات الحساب ستظهر بعد ربط حساب Celia.")}><Icon name="dots" size={19} /></button>
          </div>
        </div>
      </aside>

      <main className={`chat-main${activeView !== "chat" ? " workspace-main" : ""}`}>
        <header className="main-header">
          <div className="header-leading">
            <button className="icon-button mobile-menu-button" aria-label="فتح القائمة" onClick={() => setMobileMenuOpen(true)}><Icon name="menu" /></button>
            <span className="header-breadcrumb">2pro Workspace <Icon name="chevron" size={13} /> <strong>{activeView === "chat" ? conversationTitle : activeViewTitle}</strong></span>
          </div>
          <div className="header-actions">
            <button className="icon-button header-search-button" aria-label="بحث شامل" title="بحث شامل (⌘K)" onClick={() => { setSearchQuery(""); setSearchOpen(true); }}><Icon name="search" size={17} /></button>
            <button className="header-share-button" onClick={() => { setShareLinkSelected(false); setShareUrl(window.location.href); setShareOpen(true); }}><Icon name="share" size={15} /><span>مشاركة</span></button>
            <span className={`connection-pill ${agentMode === "live" ? "connection-live" : agentMode === "checking" ? "connection-checking" : agentMode === "error" ? "connection-error" : "connection-demo"}`}>
              <span className="connection-dot" />
              {agentMode === "live" ? "الوكيل متصل" : agentMode === "checking" ? "جارٍ التحقق" : agentMode === "error" ? "تعذّر الاتصال" : "وضع المعاينة"}
            </span>
            <button className="icon-button notification-button" aria-label="الإشعارات" onClick={() => showToast("لا توجد إشعارات جديدة.")}><Icon name="bell" size={18} /><span /></button>
          </div>
        </header>

        <div className="chat-scroll-area" ref={scrollAreaRef}>
          {activeView === "chat" ? (!hasConversation ? (
            <section className="welcome-view">
              <div className="welcome-orbit" aria-hidden="true"><span /><span /><span /></div>
              <div className="welcome-content">
                <div className="eyebrow"><span className="eyebrow-spark"><Icon name="sparkle" size={14} /></span> مساحة البناء الذكية</div>
                <h1>من فكرة عابرة<br /><span>إلى منتج جاهز.</span></h1>
                <p className="welcome-description">اكتب ما تريد إنجازه، وسأحوّله إلى خطوات واضحة<br className="desktop-break" /> تتابعها لحظة بلحظة.</p>

                <div className="suggestion-grid">
                  {starterPrompts.map((suggestion) => (
                    <button className="suggestion-card" key={suggestion.title} onClick={() => sendPrompt(suggestion.prompt)} disabled={isRunning}>
                      <span className="suggestion-icon"><Icon name={suggestion.icon} size={19} /></span>
                      <span className="suggestion-copy"><strong>{suggestion.title}</strong><small>{suggestion.description}</small></span>
                      <Icon name="arrow" size={15} className="suggestion-arrow" />
                    </button>
                  ))}
                </div>
                <div className="welcome-footnote"><span className="tiny-spark" />ابدأ بوصف النتيجة التي تريدها — لا تحتاج إلى أوامر تقنية.</div>
              </div>
            </section>
          ) : (
            <section className="message-thread" aria-label="المحادثة">
              <div className="thread-date"><span />اليوم<span /></div>
              {messages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  {message.role === "assistant" ? (
                    <div className="assistant-message-avatar"><AssistantAvatar small /></div>
                  ) : null}
                  <div className="message-body">
                    {message.role === "assistant" && <div className="message-author"><strong>Celia</strong><span>مساعدك الذكي</span>{message.demo && <span className="demo-tag">معاينة</span>}</div>}
                    <div className={`message-bubble${message.role === "assistant" ? " assistant-bubble" : " user-bubble"}`}>
                      <p>{message.text}</p>
                    </div>
                    {message.role === "assistant" && (
                      <div className="quick-actions" aria-label="إجراءات سريعة">
                        {message.actions?.map((action) => (
                          <button className={`quick-action action-${action.tone}`} key={action.id} onClick={() => sendPrompt(action.prompt)} disabled={isRunning}>
                            <Icon name={action.icon} size={16} />
                            <span>{action.label}</span>
                            <Icon name="chevron" size={14} className="action-chevron" />
                          </button>
                        ))}
                        {telegramBotUrl ? (
                          <a className="quick-action action-telegram" href={telegramBotUrl} target="_blank" rel="noreferrer">
                            <Icon name="telegram" size={16} />
                            <span>أكمل عبر Telegram</span>
                            <Icon name="external" size={13} className="action-chevron" />
                          </a>
                        ) : (
                          <button className="quick-action action-telegram" onClick={() => showToast("اضبط TELEGRAM_BOT_USERNAME لعرض رابط البوت هنا.")}>
                            <Icon name="telegram" size={16} />
                            <span>تهيئة Telegram</span>
                            <Icon name="chevron" size={14} className="action-chevron" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {isRunning && (
                <article className="message message-assistant live-message" role="status" aria-live="polite">
                  <div className="assistant-message-avatar"><AssistantAvatar small /></div>
                  <div className="message-body">
                    <div className="message-author"><strong>Celia</strong><span>مساعدك الذكي</span><span className="live-message-tag">يعمل الآن</span></div>
                    <div className="message-bubble assistant-bubble streaming-bubble">
                      <p>{streamingReply || "أجهّز خطوات التنفيذ…"}</p>
                      <span className="thinking-dots"><i /><i /><i /></span>
                    </div>
                  </div>
                </article>
              )}
            </section>
          )) : (
            <WorkspaceContent
              view={activeView}
              tasks={tasks}
              projects={projects}
              schedules={schedules}
              files={files}
              settingsTab={settingsTab}
              onSettingsTabChange={setSettingsTab}
              onOpenTask={openTask}
              onOpenProject={setSelectedProject}
              onToggleFavorite={toggleFavorite}
              onToggleSchedule={toggleSchedule}
              onOpenFile={setArtifactPreview}
              onToast={showToast}
              onNewTask={() => openTask(null)}
              onNavigateView={navigateView}
            />
          )}
        </div>

        {activeView === "chat" && <footer className="composer-wrap">
          <form className="composer" onSubmit={(event) => { event.preventDefault(); sendPrompt(input); }}>
            <div className="composer-context-chips">
              {selectedSkills.map((skillId) => {
                const skill = skillOptions.find((item) => item.command === skillId);
                return skill ? <span className="composer-context-chip" key={skill.command}>{skill.title}<button type="button" aria-label={`إزالة ${skill.title}`} onClick={() => setSelectedSkills((current) => current.filter((id) => id !== skill.command))}><Icon name="x" size={11} /></button></span> : null;
              })}
              {selectedConnectors.map((connectorId) => {
                const connector = connectorOptions.find((item) => item.id === connectorId);
                return connector ? <span className="composer-context-chip connector-chip" key={connector.id}>{connector.name} · معاينة<button type="button" aria-label={`إزالة ${connector.name}`} onClick={() => toggleConnector(connector.id)}><Icon name="x" size={11} /></button></span> : null;
              })}
              {pendingFiles.map((file, index) => <span className="composer-context-chip file-chip" key={`${file.name}-${index}`}><Icon name="paperclip" size={12} />{file.name}<button type="button" aria-label={`إزالة ${file.name}`} onClick={() => setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><Icon name="x" size={11} /></button></span>)}
            </div>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  sendPrompt(input);
                }
              }}
              placeholder="اكتب فكرتك أو المهمة التي تريد إنجازها…"
              rows={2}
              maxLength={4000}
              aria-label="اكتب رسالتك إلى Celia"
              disabled={isRunning}
            />
            <input ref={fileInputRef} className="visually-hidden-input" type="file" multiple onChange={(event) => {
              const selected = Array.from(event.target.files || []).slice(0, 5).map((file) => ({ name: file.name, size: file.size, type: file.type }));
              if (selected.length) {
                setPendingFiles((current) => [...current, ...selected].slice(0, 5));
                showToast("أُضيفت أسماء الملفات للمعاينة فقط؛ لن يُرفع محتواها.");
              }
              event.target.value = "";
            }} />
            <div className="composer-controls">
              <div className="composer-control-wrap">
                <button type="button" className="composer-tool-button" aria-expanded={connectorMenuOpen} onClick={() => { setConnectorMenuOpen((value) => !value); setSkillMenuOpen(false); setModeMenuOpen(false); }}><Icon name="plug" size={15} /><span>الموصلات</span>{selectedConnectors.length > 0 && <i>{selectedConnectors.length}</i>}</button>
                {connectorMenuOpen && <div className="composer-popover connectors-popover" role="dialog" aria-label="اختيار الموصلات"><div className="popover-heading"><strong>موصلات المهمة</strong><small>اختيار محلي — لا يوجد اتصال نشط</small></div>{connectorOptions.map((connector) => <button type="button" key={connector.id} className="connector-option" onClick={() => toggleConnector(connector.id)}><span className="connector-option-icon"><Icon name={connector.icon} size={15} /></span><span><strong>{connector.name}</strong><small>{connector.detail}</small></span><span className={`connector-status-pill${selectedConnectors.includes(connector.id) ? " connector-selected" : ""}`}>{selectedConnectors.includes(connector.id) ? "للمعاينة" : "غير مربوط"}</span></button>)}<p className="popover-disclaimer">الاختيار لا يمنح صلاحية ولا يرسل طلبًا للخدمة.</p></div>}
              </div>
              <div className="composer-control-wrap">
                <button type="button" className={`composer-tool-button${selectedSkills.length ? " composer-tool-active" : ""}`} aria-expanded={skillMenuOpen} onClick={() => { setSkillMenuOpen((value) => !value); setConnectorMenuOpen(false); setModeMenuOpen(false); }}><Icon name="sparkle" size={15} /><span>المهارات</span></button>
                {skillMenuOpen && <div className="composer-popover skills-popover" role="dialog" aria-label="اختيار مهارة"><div className="popover-heading"><strong>مهارات مقترحة</strong><small>قوالب تعليمات تُضاف إلى طلبك</small></div>{skillOptions.map((skill) => <button type="button" key={skill.command} className="skill-option" onClick={() => toggleSkill(skill.command)}><span className="skill-option-icon"><Icon name="wand" size={14} /></span><span><strong>{skill.title}</strong><small>{skill.description}</small></span><span className={`skill-check${selectedSkills.includes(skill.command) ? " skill-check-active" : ""}`}>{selectedSkills.includes(skill.command) && <Icon name="check" size={12} />}</span></button>)}<p className="popover-disclaimer">قوالب نصية محلية؛ لا تستدعي أداة خارجية.</p></div>}
              </div>
              <div className="composer-control-wrap">
                <button type="button" className="composer-tool-button" aria-expanded={modeMenuOpen} onClick={() => { setModeMenuOpen((value) => !value); setConnectorMenuOpen(false); setSkillMenuOpen(false); }}><Icon name={modeOptions.find((mode) => mode.id === selectedMode)?.icon || "sparkle"} size={15} /><span>{modeOptions.find((mode) => mode.id === selectedMode)?.name || "الوكيل"}</span><Icon name="down" size={12} /></button>
                {modeMenuOpen && <div className="composer-popover mode-popover" role="dialog" aria-label="اختيار نمط العمل"><div className="popover-heading"><strong>نمط العمل</strong><small>يُرسل كتوجيه نصي عادي للوكيل</small></div>{modeOptions.map((mode) => <button type="button" key={mode.id} className={`mode-option${selectedMode === mode.id ? " mode-option-active" : ""}`} onClick={() => { setSelectedMode(mode.id); setModeMenuOpen(false); }}><span className="mode-option-icon"><Icon name={mode.icon} size={15} /></span><span><strong>{mode.name}</strong><small>{mode.detail}</small></span>{selectedMode === mode.id && <Icon name="check" size={14} />}</button>)}</div>}
              </div>
              <button type="button" className="composer-tool-button attach-tool-button" onClick={() => fileInputRef.current?.click()}><Icon name="paperclip" size={15} /><span>إرفاق</span></button>
              <label className={`composer-learning-toggle${learnFromTask ? " composer-learning-toggle-active" : ""}`}>
                <input type="checkbox" checked={learnFromTask} onChange={(event) => setLearnFromTask(event.target.checked)} />
                <span className="composer-learn-checkbox"><Icon name={learnFromTask ? "check" : "brain"} size={11} /></span>
                <span>تعلّم من هذه المهمة</span>
              </label>
              <span className="composer-control-spacer" />
              <span className="composer-agent"><span className="composer-agent-dot" /><Icon name="sparkle" size={13} /> Celia Agent</span>
              <span className="hint-separator" />
              <span className="composer-hint">Enter للإرسال <span>·</span> Shift + Enter لسطر جديد</span>
              <button className="send-button" type="submit" aria-label="إرسال الرسالة" disabled={!input.trim() || isRunning}>
                {isRunning ? <span className="button-spinner" /> : <Icon name="send" size={17} />}
              </button>
            </div>
          </form>
          <div className="composer-disclaimer"><Icon name={learnFromTask ? "brain" : "lock"} size={12} />{learnFromTask ? "موافقة لهذه المهمة فقط: سيرسل الطلب إشارة التعلّم؛ لا تُرقّى ذاكرة أو مهارة تلقائيًا." : pendingFiles.length ? "المرفقات ظاهرة محليًا فقط؛ لن يُرسل محتواها إلى الوكيل." : selectedConnectors.length ? "الموصلات غير مربوطة؛ سيتم إرسال نص الطلب فقط." : agentMode === "demo" ? "وضع المعاينة لا ينفّذ تغييرات فعلية ولا يسجّل تجربة." : "التعلّم متوقف لهذه المهمة؛ راجع الخطوات قبل أي إجراء خارجي."}</div>
        </footer>}
      </main>

      <aside className="activity-panel">
        <div className="activity-header">
          <div className="activity-title-group">
            <span className="activity-symbol"><Icon name="sparkle" size={18} /></span>
            <div><h2>شريط التنفيذ</h2><p>خطواتك، من الفكرة إلى الإنجاز</p></div>
          </div>
          <button className="icon-button activity-more" aria-label="حول شريط التنفيذ" onClick={() => showToast("يعرض الشريط حالة الخطوات والأدوات فقط، وليس التفكير الداخلي للنموذج.")}><Icon name="dots" size={19} /></button>
        </div>

        <nav className="activity-tabs" role="tablist" aria-label="لوحة التنفيذ">
          {[
            { id: "activity", label: "النشاط", icon: "list" },
            { id: "browser", label: "المتصفح", icon: "browser" },
            { id: "terminal", label: "الطرفية", icon: "terminal" },
            { id: "files", label: "الملفات", icon: "fileText" },
            { id: "cognition", label: "العقل", icon: "brain" },
          ].map((tab) => <button key={tab.id} role="tab" aria-selected={activePanelTab === tab.id} className={activePanelTab === tab.id ? "activity-tab activity-tab-active" : "activity-tab"} onClick={() => setActivePanelTab(tab.id)}><Icon name={tab.icon} size={13} /><span>{tab.label}</span></button>)}
        </nav>

        {activePanelTab === "activity" ? <>
        <section className={`run-card run-card-${runState}`}>
          <div className="run-card-topline">
            <span className={`run-status-dot run-status-${runState}`} />
            <span className="run-status-text">{runLabel}</span>
            <span className="run-context">{runState === "idle" ? "جاهز" : agentMode === "demo" ? "معاينة" : agentMode === "error" ? "غير متصل" : "مباشر"}</span>
          </div>
          <div className="run-progress-copy">
            <strong>{runState === "idle" ? "مسارك القادم" : runState === "complete" ? "اكتمل المسار" : runState === "error" ? "توقّف المسار" : "نعمل على طلبك"}</strong>
            <span>{steps.length ? `${completedCount} من ${steps.length} خطوات` : "يبدأ التتبع عند إرسال طلب"}</span>
          </div>
          <div className="progress-track" role="progressbar" aria-label="تقدم المهمة" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="run-progress-bottom"><span>{runState === "idle" ? "Celia جاهزة للمساعدة" : runState === "complete" ? "تم تحديث حالة الخطوات" : runState === "error" ? "تحقق من اتصال الوكيل" : "تتحدّث الخطوات لحظيًا"}</span><span>{progress}%</span></div>
        </section>

        {pendingApproval && <section className={`approval-card approval-${pendingApproval.decision}`} aria-live="polite"><div className="approval-heading"><span className="approval-icon"><Icon name="shield" size={16} /></span><div><strong>مراجعة إجراء خارجي</strong><small>{pendingApproval.decision === "pending" ? "يتطلب موافقتك" : pendingApproval.decision === "allow-preview" ? "اختير السماح محليًا" : "اختير الرفض محليًا"}</small></div></div><h3>{pendingApproval.title}</h3><p>{pendingApproval.detail}</p><div className="approval-disclaimer">القرار لا يُرسل إلى الوكيل؛ لا يوجد مسار موافقات موصول بعد.</div>{pendingApproval.decision === "pending" ? <div className="approval-actions"><button onClick={() => { setPendingApproval({ ...pendingApproval, decision: "allow-preview" }); showToast("سُجّل اختيار السماح في المعاينة فقط؛ لم يُنفّذ الإجراء."); }}>سماح · معاينة</button><button onClick={() => { setPendingApproval({ ...pendingApproval, decision: "deny-preview" }); showToast("سُجّل اختيار الرفض محليًا فقط؛ لم يُرسل للوكيل."); }}>رفض · معاينة</button></div> : <button className="approval-reset" onClick={() => setPendingApproval(null)}>إخفاء الطلب</button>}</section>}

        <section className="steps-section">
          <div className="section-title-row"><h3>مراحل التنفيذ</h3><span className="step-count">{steps.length ? `${completedCount}/${steps.length}` : "مثال"}</span></div>
          {!steps.length && <div className="sample-note"><span className="sample-pulse" />ستظهر الخطوات هنا عند بدء محادثة</div>}
          <ol className="step-list">
            {visibleSteps.map((step, index) => <StepRow step={step} index={index} isLast={index === visibleSteps.length - 1} key={step.id} />)}
          </ol>
        </section>

        {executionEvents.length > 0 && <section className="execution-event-section" aria-live="polite"><div className="section-title-row"><h3>سجل أحداث التنفيذ</h3><span className="step-count">{executionEvents.length}</span></div><ol className="execution-event-list">{executionEvents.slice(-8).reverse().map((event) => <li key={event.id}><span className={`execution-event-icon event-${event.type.split(".")[0]}`}><Icon name={executionEventIcon(event.type)} size={13} /></span><div><strong>{executionEventTitle(event)}</strong><small>{executionEventDetail(event)}</small></div><span className="execution-event-sequence">#{event.sequence}</span></li>)}</ol></section>}

        <section className="integrations-section">
          <div className="section-title-row"><h3>تكاملات مقترحة</h3><span className="integrations-count">{integrations.length}</span></div>
          <div className="integration-list">
            {integrations.map((integration) => (
              <button className="integration-row" key={integration.name} onClick={() => showToast(`اربط ${integration.name} عبر وكيل Celia قبل تنفيذ الإجراءات الخارجية.`)}>
                <span className={`integration-icon integration-${integration.icon}`}><Icon name={integration.icon} size={16} /></span>
                <span className="integration-copy"><strong>{integration.name}</strong><small>{integration.detail}</small></span>
                <span className="integration-status"><i />للربط</span>
              </button>
            ))}
          </div>
        </section>

        <div className="activity-safe-note"><span className="safe-note-icon"><Icon name="shield" size={15} /></span><p><strong>أنت المتحكّم دائمًا</strong><br />الخطوات المعروضة تلخّص التنفيذ — لا تكشف التفكير الداخلي للنموذج.</p></div>
        <div className={`activity-footer${agentMode === "error" ? " activity-footer-error" : ""}`}><span className="footer-pulse" /> {agentMode === "error" ? "تعذّر الاتصال بالوكيل" : "حالة الاتصال تُحدّدها خدمة الوكيل"} <span>·</span> معاينة مجانية</div>
        </> : activePanelTab === "browser" ? (
          <section className="tool-preview-panel browser-preview-panel"><div className="tool-preview-heading"><span className="tool-preview-icon"><Icon name="browser" size={17} /></span><div><h3>المتصفح</h3><p>عرض آمن لنتائج التصفح</p></div><span className="preview-status-pill">غير موصول</span></div><div className="browser-toolbar"><span className="browser-dot" /><span className="browser-dot" /><span className="browser-dot" /><div><Icon name="lock" size={11} /> about:blank</div><button disabled aria-label="إعادة تحميل المعاينة"><Icon name="refresh" size={13} /></button></div><div className="browser-empty-state"><span><Icon name="browser" size={22} /></span><strong>لا توجد جلسة متصفح نشطة</strong><p>عند توصيل أداة متصفح، ستظهر اللقطات والروابط المفتوحة هنا. لا يتم التحكم بالمتصفح من هذه المعاينة.</p></div><div className="preview-footnote"><Icon name="shield" size={13} />لن يتم فتح مواقع أو تسجيل الدخول دون تكامل موصول وموافقة واضحة.</div></section>
        ) : activePanelTab === "terminal" ? (
          <section className="tool-preview-panel terminal-preview-panel"><div className="tool-preview-heading"><span className="tool-preview-icon"><Icon name="terminal" size={17} /></span><div><h3>الطرفية</h3><p>سجل أوامر المهمة</p></div><span className="preview-status-pill">غير موصولة</span></div><div className="terminal-window"><div className="terminal-titlebar"><span /><span /><span /><small>جلسة الطرفية</small></div><div className="terminal-body"><p><b>›</b> لا توجد جلسة طرفية مرتبطة.</p><p className="terminal-comment">ستظهر الأوامر ومخرجاتها عند توفير بيئة تنفيذ آمنة.</p><p className="terminal-cursor"><b>$</b> <i /></p></div></div><div className="preview-footnote"><Icon name="lock" size={13} />لا تُنفّذ هذه الواجهة أوامر shell محليًا أو عن بُعد.</div></section>
        ) : activePanelTab === "cognition" ? (
          <LearningWorkspacePanel snapshot={learningSnapshot} activeTab={activeCognitionTab} onTabChange={setActiveCognitionTab} />
        ) : (
          <section className="tool-preview-panel execution-files-panel"><div className="tool-preview-heading"><span className="tool-preview-icon"><Icon name="fileText" size={17} /></span><div><h3>ملفات التنفيذ</h3><p>المخرجات المرتبطة بسياق المهمة</p></div><span className="preview-status-pill">{files.length} ملفات</span></div><div className="execution-file-list">{files.map((file) => <button key={file.id} onClick={() => setArtifactPreview(file)}><span className={`execution-file-icon file-icon-${file.type}`}><Icon name={file.type === "image" ? "image" : file.type === "code" ? "code" : file.type === "link" ? "external" : "fileText"} size={15} /></span><span><strong>{file.name}</strong><small>{file.detail}</small></span><Icon name="external" size={13} /></button>)}</div><div className="preview-footnote"><Icon name="lock" size={13} />{files.some((file) => file.source === "مخرج الوكيل") ? "سُجّلت بيانات المخرجات؛ تنزيل الملفات يحتاج واجهة آمنة مستقلة." : "هذه ملفات مثال فقط؛ لن تظهر مخرجات فعلية إلا بعد ربط عقد التنفيذ."}</div></section>
        )}
      </aside>

      {searchOpen && <SearchPalette open={searchOpen} query={searchQuery} onQueryChange={setSearchQuery} tasks={tasks} projects={projects} files={files} onClose={() => setSearchOpen(false)} onSelectTask={openTaskFromSearch} onSelectProject={openProjectFromSearch} onSelectFile={openFileFromSearch} />}

      {taskDialogOpen && <div className="overlay-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTaskDialogOpen(false); }}><section className="workspace-dialog task-create-dialog" role="dialog" aria-modal="true" aria-labelledby="task-create-title"><div className="dialog-heading"><span className="dialog-icon"><Icon name="list" size={18} /></span><div><h2 id="task-create-title">مهمة جديدة</h2><p>أنشئ عنصر عمل محليًا لهذه الجلسة.</p></div><button className="icon-button" aria-label="إغلاق" onClick={() => setTaskDialogOpen(false)}><Icon name="x" size={17} /></button></div><label className="dialog-field">اسم المهمة<input autoFocus value={taskTitleDraft} onChange={(event) => setTaskTitleDraft(event.target.value)} maxLength={100} placeholder="مثال: مراجعة تجربة التسجيل" /></label><label className="dialog-field">التفاصيل<textarea rows={4} value={taskPromptDraft} onChange={(event) => setTaskPromptDraft(event.target.value)} maxLength={1000} placeholder="ما النتيجة التي تريد الوصول إليها؟" /></label><label className="dialog-field">المشروع<select value={taskProjectDraft} onChange={(event) => setTaskProjectDraft(event.target.value)}>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><div className="dialog-note"><Icon name="info" size={14} />ستُحفظ المهمة في حالة المتصفح فقط؛ لا توجد قاعدة بيانات موصولة.</div><div className="dialog-actions"><button className="dialog-secondary-button" onClick={() => setTaskDialogOpen(false)}>إلغاء</button><button className="dialog-primary-button" disabled={!taskTitleDraft.trim()} onClick={createTask}><Icon name="plus" size={14} />إنشاء المهمة</button></div></section></div>}

      {selectedTask && <div className="overlay-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTask(null); }}><section className="workspace-dialog task-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="task-detail-title"><div className="dialog-heading"><span className={`task-status-icon task-status-${selectedTask.status}`}><Icon name={selectedTask.status === "completed" ? "check" : selectedTask.status === "waiting" ? "bell" : "clock"} size={15} /></span><div><h2 id="task-detail-title">{selectedTask.title}</h2><p>{selectedTask.updated} · {projects.find((project) => project.id === selectedTask.projectId)?.name || "بدون مشروع"}</p></div><button className="icon-button" aria-label="إغلاق" onClick={() => setSelectedTask(null)}><Icon name="x" size={17} /></button></div><div className="task-detail-status-row"><span className={`task-status-label task-label-${selectedTask.status}`}>{({ queued: "في الانتظار", running: "قيد التنفيذ", waiting: "بانتظارك", permission: "يتطلب إذنًا", paused: "متوقف مؤقتًا", completed: "مكتمل", failed: "فشل", cancelled: "أُلغي" })[selectedTask.status] || "في الانتظار"}</span><span className="task-detail-local-badge">بيانات نموذجية</span></div><section className="task-detail-section"><h3>الهدف</h3><p>{selectedTask.prompt || selectedTask.description}</p></section><section className="task-detail-section"><h3>سجل الحالة</h3><div className="task-detail-timeline"><span className="timeline-marker"><Icon name="check" size={11} /></span><div><strong>{selectedTask.status === "completed" ? "اكتملت المهمة" : "آخر تحديث"}</strong><small>{selectedTask.updated} · تمثيل واجهة غير متصل بسجل تنفيذ.</small></div></div><div className="task-detail-timeline timeline-muted"><span className="timeline-marker"><Icon name="circle" size={10} /></span><div><strong>لا يوجد سجل تنفيذ حقيقي</strong><small>تظهر نتائج Celia هنا عند ربط تخزين المهام بالخدمة.</small></div></div></section><div className="dialog-actions task-detail-actions"><button className="dialog-secondary-button" onClick={() => { toggleFavorite(selectedTask.id); setSelectedTask((current) => ({ ...current, favorite: !current.favorite })); }}><Icon name="star" size={14} />{selectedTask.favorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}</button><button className="dialog-primary-button" onClick={() => handleTaskRun(selectedTask)}><Icon name="message" size={14} />متابعة في المحادثة</button></div></section></div>}

      {selectedProject && <div className="overlay-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProject(null); }}><section className="workspace-dialog project-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="project-detail-title"><div className="dialog-heading"><span className="project-icon"><Icon name="folder" size={17} /></span><div><h2 id="project-detail-title">{selectedProject.name}</h2><p>{selectedProject.description}</p></div><button className="icon-button" aria-label="إغلاق" onClick={() => setSelectedProject(null)}><Icon name="x" size={17} /></button></div><div className="project-detail-instructions"><span>تعليمات المشروع</span><p>{selectedProject.instructions}</p></div><div className="section-subheading dialog-section-subheading"><h2>مهام المشروع</h2><span>{tasks.filter((task) => task.projectId === selectedProject.id).length}</span></div>{tasks.filter((task) => task.projectId === selectedProject.id).length ? <div className="project-detail-task-list">{tasks.filter((task) => task.projectId === selectedProject.id).map((task) => <button key={task.id} onClick={() => { setSelectedProject(null); setSelectedTask(task); }}><span className={`task-status-icon task-status-${task.status}`}><Icon name={task.status === "completed" ? "check" : "clock"} size={13} /></span><span><strong>{task.title}</strong><small>{task.updated}</small></span><Icon name="chevron" size={13} /></button>)}</div> : <div className="project-detail-empty">لا توجد مهام في هذا المشروع بعد.</div>}<div className="dialog-actions"><button className="dialog-secondary-button" onClick={() => { toggleProjectFavorite(selectedProject.id); setSelectedProject((current) => ({ ...current, favorite: !current.favorite })); }}><Icon name="star" size={14} />{selectedProject.favorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}</button><button className="dialog-primary-button" onClick={() => { setTaskTitleDraft(""); setTaskPromptDraft(""); setTaskProjectDraft(selectedProject.id); setSelectedProject(null); setTaskDialogOpen(true); }}><Icon name="plus" size={14} />إضافة مهمة</button></div></section></div>}

      {artifactPreview && <div className="overlay-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setArtifactPreview(null); }}><section className="workspace-dialog artifact-dialog" role="dialog" aria-modal="true" aria-labelledby="artifact-title"><div className="dialog-heading"><span className="dialog-icon"><Icon name={artifactPreview.type === "image" ? "image" : artifactPreview.type === "link" ? "external" : "fileText"} size={17} /></span><div><h2 id="artifact-title">{artifactPreview.name}</h2><p>{artifactPreview.detail || "ملف محلي"}</p></div><button className="icon-button" aria-label="إغلاق" onClick={() => setArtifactPreview(null)}><Icon name="x" size={17} /></button></div><div className="artifact-preview-body"><span className="artifact-preview-symbol"><Icon name={artifactPreview.type === "image" ? "image" : artifactPreview.type === "link" ? "external" : "fileText"} size={24} /></span><strong>معاينة الملف</strong><p>{artifactPreview.source === "مخرج الوكيل" ? `سُجّلت بيانات وصفية من حدث التنفيذ (${artifactPreview.detail || "مخرج"}).` : artifactPreview.source ? `مرتبط بـ ${artifactPreview.source}.` : "لم يتم تحميل الملف إلى مساحة العمل."} لا يتوفر محتوى الملف في هذه الواجهة.</p></div><div className="dialog-note"><Icon name="lock" size={14} />قراءة محتوى الملفات وتنزيلها يحتاجان إلى واجهة ملفات بصلاحيات مناسبة.</div><div className="dialog-actions"><button className="dialog-secondary-button" onClick={() => setArtifactPreview(null)}>إغلاق</button><button className="dialog-primary-button" onClick={() => { setArtifactPreview(null); navigateView("library"); }}>فتح المكتبة</button></div></section></div>}

      {shareOpen && <div className="overlay-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareOpen(false); }}><section className="workspace-dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title"><div className="dialog-heading"><span className="dialog-icon"><Icon name="share" size={17} /></span><div><h2 id="share-title">مشاركة مساحة العمل</h2><p>شارك الصفحة الحالية أو دعُ عضوًا.</p></div><button className="icon-button" aria-label="إغلاق" onClick={() => setShareOpen(false)}><Icon name="x" size={17} /></button></div><div className="share-access-card"><div><strong>صلاحية الرابط</strong><small>رابط المعاينة الحالي فقط</small></div><span className="share-preview-badge">لا يغيّر الصلاحيات</span></div><label className="share-url-field"><span>رابط المعاينة — انسخه يدويًا إذا منع المتصفح الحافظة</span><input ref={shareUrlInputRef} type="url" dir="ltr" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} aria-label="رابط صفحة المعاينة" /></label><button className="share-copy-button" onClick={handleShareCopy}><Icon name={shareLinkSelected ? "check" : "share"} size={15} />{shareLinkSelected ? "تم تحديد الرابط" : "تحديد الرابط للنسخ"}</button><form className="share-invite-form" onSubmit={(event) => { event.preventDefault(); if (inviteEmail.trim()) showToast("لم تُرسل الدعوة؛ خدمة أعضاء مساحة العمل غير موصولة."); setInviteEmail(""); }}><label htmlFor="invite-email">دعوة عضو بالبريد</label><div><input id="invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" /><button type="submit" disabled={!inviteEmail.trim()}>دعوة</button></div></form><div className="dialog-note"><Icon name="info" size={14} />النسخ لا ينشئ رابط مشاركة عامًا ولا يضيف أعضاء؛ يتطلب ذلك خدمة صلاحيات.</div></section></div>}

      {toast && <div className="toast-message" role="status"><span className="toast-check"><Icon name="check" size={14} /></span>{toast}</div>}
    </div>
  );
}

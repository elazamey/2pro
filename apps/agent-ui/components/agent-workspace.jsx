"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icon.jsx";

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

function parseSseFrame(frame) {
  let event = "message";
  const dataLines = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  if (raw === "[DONE]") return { event: "done", data: {} };
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: { text: raw } };
  }
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
      if (parsed && onEvent(parsed.event, parsed.data) === false) {
        await reader.cancel();
        return;
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const parsed = parseSseFrame(buffer);
    if (parsed && onEvent(parsed.event, parsed.data) === false) await reader.cancel();
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [streamingReply, setStreamingReply] = useState("");
  const scrollAreaRef = useRef(null);
  const textareaRef = useRef(null);
  const toastTimerRef = useRef(null);

  const isRunning = runState === "running";
  const hasConversation = messages.length > 0;
  const conversationTitle = hasConversation
    ? (messages.find((message) => message.role === "user")?.text || "محادثة جديدة").slice(0, 34)
    : "محادثة جديدة";

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
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, runState, streamingReply]);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  function showToast(text) {
    setToast(text);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 3200);
  }

  async function animateDemoSteps(prompt) {
    const taskSteps = makeTaskSteps(prompt);
    for (let current = 0; current < taskSteps.length; current += 1) {
      setSteps(taskSteps.map((step, index) => ({
        ...step,
        status: index < current ? "done" : index === current ? "running" : "pending",
      })));
      await wait(current === 0 ? 480 : 570);
    }
    setSteps(taskSteps.map((step) => ({ ...step, status: "done" })));
  }

  async function sendPrompt(rawText) {
    const prompt = rawText.trim();
    if (!prompt || isRunning) return;

    setInput("");
    setStreamingReply("");
    setMobileMenuOpen(false);
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
          history: messages.slice(-20).map((message) => ({ role: message.role, content: message.text })),
        }),
      });
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

        await consumeAgentStream(response, (eventName, rawData) => {
          const data = rawData && typeof rawData === "object" ? rawData : {};
          const eventType = data.type || eventName;
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
        if (streamError) throw new Error(streamError);

        if (streamConversationId) setConversationId(streamConversationId);
        setMessages((current) => [...current, {
          id: makeId(), role: "assistant", text: streamText || "اكتملت المهمة.", actions: streamActions, demo: false,
        }]);
        setStreamingReply("");
      } else {
        const data = await response.json().catch(() => ({}));
        if (data.mode === "demo") {
          setAgentMode("demo");
          await animateDemoSteps(prompt);
          const actions = normalizeActions(defaultActions);
          setMessages((current) => [...current, {
            id: makeId(),
            role: "assistant",
            text: demoReply(prompt),
            actions,
            demo: true,
          }]);
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
      setRunState("complete");
    } catch (error) {
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
    setMessages([]);
    setConversationId(makeId());
    setInput("");
    setSteps([]);
    setRunState("idle");
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
          <kbd>⌘ K</kbd>
        </button>

        <div className="sidebar-section-label">مساحة العمل</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">2</span>
          <span className="workspace-switch-copy"><strong>2pro Workspace</strong><small>مساحة شخصية</small></span>
          <Icon name="down" size={15} className="workspace-chevron" />
        </div>

        <div className="sidebar-section-heading">
          <span>المحادثات الأخيرة</span>
          <button className="icon-button mini-icon-button" aria-label="محادثة جديدة" onClick={startNewChat}><Icon name="plus" size={15} /></button>
        </div>
        <div className="conversation-list">
          {exampleConversations.map((conversation, index) => (
            <button className={`conversation-link${index === 0 && !hasConversation ? " conversation-selected" : ""}`} key={conversation.title} onClick={() => useExample(conversation.prompt)}>
              <span className={`conversation-dot dot-${conversation.color}`} />
              <span className="conversation-title">{conversation.title}</span>
              <span className="conversation-time">{index === 0 ? "الآن" : index === 1 ? "أمس" : "قبل يومين"}</span>
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
            <div className="profile-copy"><strong>مساحة عملك</strong><span>الخطة المجانية</span></div>
            <button className="icon-button profile-menu" aria-label="المزيد" onClick={() => showToast("إعدادات الحساب ستظهر بعد ربط حساب Celia.")}><Icon name="dots" size={19} /></button>
          </div>
        </div>
      </aside>

      <main className="chat-main">
        <header className="main-header">
          <div className="header-leading">
            <button className="icon-button mobile-menu-button" aria-label="فتح القائمة" onClick={() => setMobileMenuOpen(true)}><Icon name="menu" /></button>
            <span className="header-breadcrumb">2pro Workspace <Icon name="chevron" size={13} /> <strong>{conversationTitle}</strong></span>
          </div>
          <div className="header-actions">
            <span className={`connection-pill ${agentMode === "live" ? "connection-live" : agentMode === "checking" ? "connection-checking" : agentMode === "error" ? "connection-error" : "connection-demo"}`}>
              <span className="connection-dot" />
              {agentMode === "live" ? "الوكيل متصل" : agentMode === "checking" ? "جارٍ التحقق" : agentMode === "error" ? "تعذّر الاتصال" : "وضع المعاينة"}
            </span>
            <button className="icon-button notification-button" aria-label="الإشعارات" onClick={() => showToast("لا توجد إشعارات جديدة.")}><Icon name="bell" size={18} /><span /></button>
          </div>
        </header>

        <div className="chat-scroll-area" ref={scrollAreaRef}>
          {!hasConversation ? (
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
                    {message.actions?.length > 0 && (
                      <div className="quick-actions" aria-label="إجراءات سريعة">
                        {message.actions.map((action) => (
                          <button className={`quick-action action-${action.tone}`} key={action.id} onClick={() => sendPrompt(action.prompt)} disabled={isRunning}>
                            <Icon name={action.icon} size={16} />
                            <span>{action.label}</span>
                            <Icon name="chevron" size={14} className="action-chevron" />
                          </button>
                        ))}
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
          )}
        </div>

        <footer className="composer-wrap">
          <form className="composer" onSubmit={(event) => { event.preventDefault(); sendPrompt(input); }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
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
            <div className="composer-toolbar">
              <div className="composer-hints">
                <span className="composer-agent"><span className="composer-agent-dot" /><Icon name="sparkle" size={13} /> Celia Agent</span>
                <span className="hint-separator" />
                <span className="composer-hint">Enter للإرسال <span>·</span> Shift + Enter لسطر جديد</span>
              </div>
              <button className="send-button" type="submit" aria-label="إرسال الرسالة" disabled={!input.trim() || isRunning}>
                {isRunning ? <span className="button-spinner" /> : <Icon name="send" size={17} />}
              </button>
            </div>
          </form>
          <div className="composer-disclaimer"><Icon name="lock" size={12} />{agentMode === "demo" ? "وضع المعاينة لا ينفّذ تغييرات فعلية على ملفاتك أو حساباتك." : "راجع الخطوات والنتائج قبل تأكيد أي إجراء خارجي."}</div>
        </footer>
      </main>

      <aside className="activity-panel">
        <div className="activity-header">
          <div className="activity-title-group">
            <span className="activity-symbol"><Icon name="sparkle" size={18} /></span>
            <div><h2>شريط التنفيذ</h2><p>خطواتك، من الفكرة إلى الإنجاز</p></div>
          </div>
          <button className="icon-button activity-more" aria-label="حول شريط التنفيذ" onClick={() => showToast("يعرض الشريط حالة الخطوات والأدوات فقط، وليس التفكير الداخلي للنموذج.")}><Icon name="dots" size={19} /></button>
        </div>

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

        <section className="steps-section">
          <div className="section-title-row"><h3>مراحل التنفيذ</h3><span className="step-count">{steps.length ? `${completedCount}/${steps.length}` : "مثال"}</span></div>
          {!steps.length && <div className="sample-note"><span className="sample-pulse" />ستظهر الخطوات هنا عند بدء محادثة</div>}
          <ol className="step-list">
            {visibleSteps.map((step, index) => <StepRow step={step} index={index} isLast={index === visibleSteps.length - 1} key={step.id} />)}
          </ol>
        </section>

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
        <div className={`activity-footer${agentMode === "error" ? " activity-footer-error" : ""}`}><span className="footer-pulse" /> {agentMode === "error" ? "تعذّر الاتصال بالوكيل" : "جميع الأنظمة تعمل"} <span>·</span> معاينة مجانية</div>
      </aside>

      {toast && <div className="toast-message" role="status"><span className="toast-check"><Icon name="check" size={14} /></span>{toast}</div>}
    </div>
  );
}

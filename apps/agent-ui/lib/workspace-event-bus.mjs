import { randomUUID } from "node:crypto";
import {
  WORKSPACE_EVENT_TYPES,
  learningContract,
  parseMemoryScope,
  parseWorkspaceEvent,
} from "./learning-contract.mjs";

const EVENT_TYPE_SET = new Set(WORKSPACE_EVENT_TYPES);
const DEFAULT_MAX_EVENTS_PER_SCOPE = 500;
const DEFAULT_MAX_SUBSCRIBERS_PER_SCOPE = 100;
const DEFAULT_MAX_BUFFERED_EVENTS = 512;

export class WorkspaceEventBusError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "WorkspaceEventBusError";
    this.code = code;
  }
}

export class WorkspaceReplayGapError extends WorkspaceEventBusError {
  constructor(requestedSequence, oldestAvailableSequence) {
    super("The requested workspace event cursor is older than the replay window.", "WORKSPACE_REPLAY_GAP");
    this.name = "WorkspaceReplayGapError";
    this.requestedSequence = requestedSequence;
    this.oldestAvailableSequence = oldestAvailableSequence;
  }
}

export class WorkspaceCursorNotFoundError extends WorkspaceEventBusError {
  constructor(eventId) {
    super("The workspace event ID is not available in this process replay window.", "WORKSPACE_CURSOR_NOT_FOUND");
    this.name = "WorkspaceCursorNotFoundError";
    this.eventId = eventId;
  }
}

export class WorkspaceSubscriberOverflowError extends WorkspaceEventBusError {
  constructor(maxBufferedEvents) {
    super("The workspace subscriber exceeded its bounded event buffer.", "WORKSPACE_SUBSCRIBER_OVERFLOW");
    this.name = "WorkspaceSubscriberOverflowError";
    this.maxBufferedEvents = maxBufferedEvents;
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function scopeKey(scope) {
  return JSON.stringify([scope.type, scope.id]);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function completed(value) {
  return Promise.resolve({ value, done: true });
}

class WorkspaceSubscription {
  constructor(channel, initialEvents, { maxBufferedEvents, signal }) {
    this.channel = channel;
    this.queue = initialEvents;
    this.maxBufferedEvents = maxBufferedEvents;
    this.waiters = [];
    this.error = null;
    this.closed = false;
    this.signal = signal;
    this.abortListener = () => this.close();

    if (signal) {
      if (signal.aborted) {
        this.queue = [];
        this.closed = true;
      } else signal.addEventListener("abort", this.abortListener, { once: true });
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    if (this.queue.length) return Promise.resolve({ value: this.queue.shift(), done: false });
    if (this.error) return Promise.reject(this.error);
    if (this.closed) return completed(undefined);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  enqueue(event) {
    if (this.closed || this.error) return;
    if (this.waiters.length) {
      this.waiters.shift().resolve({ value: event, done: false });
      return;
    }
    if (this.queue.length >= this.maxBufferedEvents) {
      this.fail(new WorkspaceSubscriberOverflowError(this.maxBufferedEvents));
      return;
    }
    this.queue.push(event);
  }

  fail(error) {
    if (this.error || this.closed) return;
    this.error = error;
    this.detach();
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.detach();
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  detach() {
    this.channel.subscribers.delete(this);
    if (this.signal) this.signal.removeEventListener("abort", this.abortListener);
  }

  return() {
    this.close();
    return completed(undefined);
  }

  throw(error) {
    this.fail(error);
    return Promise.reject(error);
  }
}

/**
 * Process-local, non-durable Workspace Event Bus.
 * Scope authorization and durable outbox/replay belong to a later gateway layer.
 */
export class WorkspaceEventBus {
  constructor({
    maxEventsPerScope = DEFAULT_MAX_EVENTS_PER_SCOPE,
    maxSubscribersPerScope = DEFAULT_MAX_SUBSCRIBERS_PER_SCOPE,
    maxBufferedEvents = DEFAULT_MAX_BUFFERED_EVENTS,
    clock = () => new Date().toISOString(),
    createId = randomUUID,
  } = {}) {
    this.maxEventsPerScope = positiveInteger(maxEventsPerScope, "maxEventsPerScope");
    this.maxSubscribersPerScope = positiveInteger(maxSubscribersPerScope, "maxSubscribersPerScope");
    this.maxBufferedEvents = positiveInteger(maxBufferedEvents, "maxBufferedEvents");
    if (typeof clock !== "function") throw new TypeError("clock must be a function.");
    if (typeof createId !== "function") throw new TypeError("createId must be a function.");
    this.clock = clock;
    this.createId = createId;
    this.channels = new Map();
    this.closed = false;
  }

  publish({ type, scope: rawScope, source, approvalId = null, payload, occurredAt } = {}) {
    if (this.closed) throw new WorkspaceEventBusError("The workspace event bus is closed.", "WORKSPACE_BUS_CLOSED");
    if (!EVENT_TYPE_SET.has(type)) throw new WorkspaceEventBusError("Unsupported workspace event type.", "WORKSPACE_EVENT_TYPE_INVALID");

    const scope = parseMemoryScope(rawScope, "workspaceEvent.scope");
    const key = scopeKey(scope);
    const channel = this.#channel(key);
    const sequence = channel.sequence + 1;
    if (!Number.isSafeInteger(sequence)) throw new WorkspaceEventBusError("Workspace sequence exceeded the safe integer range.", "WORKSPACE_SEQUENCE_EXHAUSTED");

    const id = this.createId();
    if (channel.events.some((event) => event.id === id)) {
      throw new WorkspaceEventBusError("Workspace event IDs must be unique within a scope replay window.", "WORKSPACE_EVENT_ID_DUPLICATE");
    }
    const draft = {
      contractVersion: learningContract.version,
      id,
      sequence,
      occurredAt: occurredAt === undefined ? this.clock() : occurredAt,
      scope,
      type,
      source,
      approvalId,
      payload,
    };
    const event = parseWorkspaceEvent(type, draft, id);
    if (!event) throw new WorkspaceEventBusError("Workspace event payload was not recognized.", "WORKSPACE_EVENT_INVALID");
    const immutableEvent = deepFreeze(event);

    channel.sequence = sequence;
    channel.events.push(immutableEvent);
    if (channel.events.length > this.maxEventsPerScope) channel.events.splice(0, channel.events.length - this.maxEventsPerScope);
    for (const subscriber of channel.subscribers) subscriber.enqueue(immutableEvent);
    return immutableEvent;
  }

  subscribe(rawScope, { afterSequence, afterEventId, signal } = {}) {
    if (this.closed) throw new WorkspaceEventBusError("The workspace event bus is closed.", "WORKSPACE_BUS_CLOSED");
    if (signal != null && (typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) {
      throw new TypeError("signal must be an AbortSignal.");
    }
    const scope = parseMemoryScope(rawScope, "workspaceEvent.scope");
    if (afterSequence !== undefined && afterEventId !== undefined) {
      throw new TypeError("Provide afterSequence or afterEventId, not both.");
    }
    const channel = this.#channel(scopeKey(scope));
    let cursor = 0;
    if (afterEventId !== undefined) {
      if (typeof afterEventId !== "string" || !afterEventId.trim()) throw new TypeError("afterEventId must be a non-empty string.");
      const cursorEvent = channel.events.find((event) => event.id === afterEventId);
      if (!cursorEvent) throw new WorkspaceCursorNotFoundError(afterEventId);
      cursor = cursorEvent.sequence;
    } else if (afterSequence !== undefined) {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new TypeError("afterSequence must be a non-negative safe integer.");
      cursor = afterSequence;
    }

    if (cursor > channel.sequence) {
      throw new WorkspaceEventBusError("The workspace event cursor is ahead of the current sequence.", "WORKSPACE_CURSOR_IN_FUTURE");
    }
    const oldestAvailableSequence = channel.events[0]?.sequence;
    if (oldestAvailableSequence !== undefined && cursor < oldestAvailableSequence - 1) {
      throw new WorkspaceReplayGapError(cursor, oldestAvailableSequence);
    }
    const replay = channel.events.filter((event) => event.sequence > cursor);
    if (replay.length > this.maxBufferedEvents) {
      throw new WorkspaceEventBusError("The requested replay exceeds the subscriber buffer; resume from a later cursor.", "WORKSPACE_REPLAY_TOO_LARGE");
    }
    if (channel.subscribers.size >= this.maxSubscribersPerScope) {
      throw new WorkspaceEventBusError("The workspace scope has reached its subscriber limit.", "WORKSPACE_SUBSCRIBER_LIMIT");
    }

    const subscription = new WorkspaceSubscription(channel, replay, {
      maxBufferedEvents: this.maxBufferedEvents,
      signal,
    });
    if (!subscription.closed) channel.subscribers.add(subscription);
    return subscription;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const channel of this.channels.values()) {
      for (const subscriber of [...channel.subscribers]) subscriber.close();
      channel.subscribers.clear();
    }
  }

  #channel(key) {
    let channel = this.channels.get(key);
    if (!channel) {
      channel = { sequence: 0, events: [], subscribers: new Set() };
      this.channels.set(key, channel);
    }
    return channel;
  }
}

export function formatWorkspaceSseFrame(value) {
  const event = parseWorkspaceEvent(value?.type, value, value?.id);
  if (!event) throw new WorkspaceEventBusError("Cannot serialize an unknown workspace event.", "WORKSPACE_EVENT_INVALID");
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

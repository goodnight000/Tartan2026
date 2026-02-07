import { html, nothing } from "lit";
import { extractText } from "../chat/message-extract.ts";
import type {
  CarePilotProfileDraft,
  CarePilotPrivacyReceipt,
  CarePilotSection,
  CarePilotUiState,
} from "../controllers/carepilot.ts";
import { formatAgo } from "../format.ts";

export type CarePilotProps = {
  connected: boolean;
  loading: boolean;
  error: string | null;
  state: CarePilotUiState | null;
  activeSection: CarePilotSection;
  onboardingStep: number;
  onboardingDraft: CarePilotProfileDraft;
  savingProfile: boolean;
  privacyBusy: "export" | "delete" | null;
  lastReceipt: CarePilotPrivacyReceipt | null;
  recording: boolean;
  audioPreviewUrl: string | null;
  transcriptDraft: string;
  transcriptConfidence: number | null;
  transcriptError: string | null;
  chatDraft: string;
  chatSending: boolean;
  chatMessages: unknown[];
  onSectionChange: (section: CarePilotSection) => void;
  onOnboardingStepChange: (step: number) => void;
  onDraftChange: (patch: Partial<CarePilotProfileDraft>) => void;
  onSaveProfile: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTranscribe: () => void;
  onTranscriptDraftChange: (text: string) => void;
  onApplyTranscriptToChat: () => void;
  onChatDraftChange: (text: string) => void;
  onSendChat: () => void;
  onRefresh: () => void;
  onRunPrivacy: (action: "export" | "delete") => void;
};

const SECTION_ORDER: CarePilotSection[] = [
  "onboarding",
  "chat",
  "dashboard",
  "actions",
  "settings",
];

const SECTION_TITLES: Record<CarePilotSection, string> = {
  onboarding: "Onboarding Intake",
  chat: "Care Chat + Voice",
  dashboard: "Health Dashboard",
  actions: "Action Receipts",
  settings: "Settings & Privacy",
};

const SECTION_SUBTITLES: Record<CarePilotSection, string> = {
  onboarding: "Collect baseline profile and care preferences before automation.",
  chat: "Capture a voice snippet, confirm transcript, and send through chat.",
  dashboard: "Connected source cards, metric freshness, and symptom context.",
  actions: "Deterministic timeline of care actions and outcomes.",
  settings: "Permissions, proactive controls, and privacy requests.",
};

function statusTone(value: string): "good" | "warn" | "bad" | "neutral" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "connected" || normalized === "fresh" || normalized === "succeeded") {
    return "good";
  }
  if (normalized === "error" || normalized === "failed" || normalized === "blocked") {
    return "bad";
  }
  if (
    normalized === "stale" ||
    normalized === "pending" ||
    normalized === "partial" ||
    normalized === "disconnected"
  ) {
    return "warn";
  }
  return "neutral";
}

function renderStatusPill(label: string, value: string) {
  const tone = statusTone(value);
  return html`
    <div class="cp-pill cp-pill--${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderSectionNav(props: CarePilotProps) {
  return html`
    <div class="cp-section-nav" role="tablist" aria-label="CarePilot sections">
      ${SECTION_ORDER.map((section) => {
        const active = section === props.activeSection;
        return html`
          <button
            class="cp-section-tab ${active ? "is-active" : ""}"
            role="tab"
            aria-selected=${active}
            @click=${() => props.onSectionChange(section)}
          >
            <span class="cp-section-tab__label">${SECTION_TITLES[section]}</span>
            <span class="cp-section-tab__sub">${SECTION_SUBTITLES[section]}</span>
          </button>
        `;
      })}
    </div>
  `;
}

function renderOnboarding(props: CarePilotProps) {
  const draft = props.onboardingDraft;
  const step = Math.max(0, Math.min(2, props.onboardingStep));
  const canGoBack = step > 0;
  const canGoNext = step < 2;

  const stepCard = (() => {
    if (step === 0) {
      return html`
        <div class="cp-form-grid">
          <label class="field">
            <span>Timezone</span>
            <input
              .value=${draft.timezone}
              @input=${(event: Event) =>
                props.onDraftChange({ timezone: (event.target as HTMLInputElement).value })}
              placeholder="America/New_York"
            />
          </label>
          <label class="field">
            <span>Locale</span>
            <input
              .value=${draft.locale}
              @input=${(event: Event) =>
                props.onDraftChange({ locale: (event.target as HTMLInputElement).value })}
              placeholder="en-US"
            />
          </label>
          <label class="field">
            <span>Birth year</span>
            <input
              type="number"
              .value=${draft.dateOfBirthYear}
              @input=${(event: Event) =>
                props.onDraftChange({ dateOfBirthYear: (event.target as HTMLInputElement).value })}
              placeholder="1990"
            />
          </label>
          <label class="field">
            <span>Biological sex</span>
            <select
              .value=${draft.biologicalSex}
              @change=${(event: Event) =>
                props.onDraftChange({ biologicalSex: (event.target as HTMLSelectElement).value })}
            >
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="intersex">Intersex</option>
            </select>
          </label>
        </div>
      `;
    }

    if (step === 1) {
      return html`
        <div class="cp-form-grid">
          <label class="field">
            <span>Proactive mode</span>
            <select
              .value=${draft.proactiveMode}
              @change=${(event: Event) =>
                props.onDraftChange({
                  proactiveMode: (event.target as HTMLSelectElement)
                    .value as CarePilotProfileDraft["proactiveMode"],
                })}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="medication_only">Medication only</option>
            </select>
          </label>
          <label class="field">
            <span>Quiet hours start</span>
            <input
              type="time"
              .value=${draft.quietHoursStart}
              @input=${(event: Event) =>
                props.onDraftChange({ quietHoursStart: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>Quiet hours end</span>
            <input
              type="time"
              .value=${draft.quietHoursEnd}
              @input=${(event: Event) =>
                props.onDraftChange({ quietHoursEnd: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>Snooze days (optional)</span>
            <input
              type="number"
              min="0"
              .value=${draft.snoozeDays}
              @input=${(event: Event) =>
                props.onDraftChange({ snoozeDays: (event.target as HTMLInputElement).value })}
              placeholder="0"
            />
          </label>
        </div>
      `;
    }

    return html`
      <div class="cp-review-grid">
        <div class="cp-review-row"><span>Timezone</span><strong>${draft.timezone}</strong></div>
        <div class="cp-review-row"><span>Locale</span><strong>${draft.locale}</strong></div>
        <div class="cp-review-row">
          <span>Birth year</span>
          <strong>${draft.dateOfBirthYear || "not set"}</strong>
        </div>
        <div class="cp-review-row">
          <span>Biological sex</span>
          <strong>${draft.biologicalSex || "not set"}</strong>
        </div>
        <div class="cp-review-row">
          <span>Proactive mode</span>
          <strong>${draft.proactiveMode}</strong>
        </div>
        <div class="cp-review-row">
          <span>Quiet hours</span>
          <strong>${draft.quietHoursStart} - ${draft.quietHoursEnd}</strong>
        </div>
        <div class="cp-review-row">
          <span>Snooze days</span>
          <strong>${draft.snoozeDays || "0"}</strong>
        </div>
      </div>
    `;
  })();

  return html`
    <section class="cp-panel">
      <div class="cp-panel__head">
        <h3>Onboarding wizard</h3>
        <div class="cp-stepper" aria-label="Onboarding steps">
          ${[0, 1, 2].map(
            (index) =>
              html`<button
                class="cp-step ${index === step ? "is-active" : ""}"
                @click=${() => props.onOnboardingStepChange(index)}
              >
                ${index + 1}
              </button>`,
          )}
        </div>
      </div>
      ${stepCard}
      <div class="cp-actions-row">
        <button class="btn" ?disabled=${!canGoBack} @click=${() => props.onOnboardingStepChange(step - 1)}>
          Back
        </button>
        ${
          canGoNext
            ? html`<button class="btn primary" @click=${() => props.onOnboardingStepChange(step + 1)}>
                Next
              </button>`
            : html`<button class="btn primary" ?disabled=${props.savingProfile} @click=${props.onSaveProfile}>
                ${props.savingProfile ? "Saving…" : "Save onboarding"}
              </button>`
        }
      </div>
    </section>
  `;
}

function normalizeChatPreview(messages: unknown[]): Array<{ role: string; text: string }> {
  return messages
    .map((entry) => {
      const record = entry as { role?: unknown };
      const role = typeof record.role === "string" ? record.role : "assistant";
      const text = extractText(entry) ?? "";
      return {
        role,
        text,
      };
    })
    .filter((entry) => entry.text.trim().length > 0)
    .slice(-12);
}

function renderChat(props: CarePilotProps) {
  const chatPreview = normalizeChatPreview(props.chatMessages);

  return html`
    <section class="cp-grid cp-grid--chat">
      <div class="cp-panel">
        <div class="cp-panel__head">
          <h3>Voice capture + transcript confirm</h3>
          ${renderStatusPill("Mic", props.recording ? "recording" : "idle")}
        </div>
        <div class="cp-actions-row">
          <button class="btn" ?disabled=${props.recording} @click=${props.onStartRecording}>
            Start capture
          </button>
          <button class="btn" ?disabled=${!props.recording} @click=${props.onStopRecording}>
            Stop capture
          </button>
          <button
            class="btn primary"
            ?disabled=${props.recording || !props.audioPreviewUrl}
            @click=${props.onTranscribe}
          >
            Transcribe
          </button>
        </div>
        ${
          props.audioPreviewUrl
            ? html`<audio class="cp-audio" controls src=${props.audioPreviewUrl}></audio>`
            : html`<div class="cp-empty">No audio clip captured yet.</div>`
        }
        <label class="field" style="margin-top: 14px;">
          <span>Transcript (editable confirmation)</span>
          <textarea
            rows="5"
            .value=${props.transcriptDraft}
            @input=${(event: Event) =>
              props.onTranscriptDraftChange((event.target as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
        <div class="cp-actions-row">
          <button
            class="btn"
            ?disabled=${!props.transcriptDraft.trim()}
            @click=${props.onApplyTranscriptToChat}
          >
            Use transcript in chat composer
          </button>
          ${
            props.transcriptConfidence != null
              ? html`<span class="cp-meta">Confidence ${Math.round(props.transcriptConfidence * 100)}%</span>`
              : nothing
          }
        </div>
        ${props.transcriptError ? html`<div class="callout danger">${props.transcriptError}</div>` : nothing}
      </div>

      <div class="cp-panel">
        <div class="cp-panel__head">
          <h3>Care chat</h3>
          ${renderStatusPill("Gateway", props.connected ? "connected" : "offline")}
        </div>
        <div class="cp-chat-stream" role="log" aria-live="polite">
          ${
            chatPreview.length === 0
              ? html`<div class="cp-empty">No chat messages in this session yet.</div>`
              : chatPreview.map(
                  (item) => html`
                    <article class="cp-chat-row cp-chat-row--${item.role === "user" ? "user" : "assistant"}">
                      <div class="cp-chat-role">${item.role}</div>
                      <p>${item.text}</p>
                    </article>
                  `,
                )
          }
        </div>
        <label class="field" style="margin-top: 14px;">
          <span>Compose message</span>
          <textarea
            rows="4"
            .value=${props.chatDraft}
            @input=${(event: Event) => props.onChatDraftChange((event.target as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
        <div class="cp-actions-row">
          <button class="btn primary" ?disabled=${props.chatSending || !props.chatDraft.trim()} @click=${props.onSendChat}>
            ${props.chatSending ? "Sending…" : "Send to CarePilot"}
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderDashboard(props: CarePilotProps) {
  const data = props.state;
  if (!data) {
    return html`<section class="cp-panel"><div class="cp-empty">No dashboard data available.</div></section>`;
  }

  return html`
    <section class="cp-grid cp-grid--dashboard">
      <div class="cp-panel cp-panel--hero">
        <div class="cp-panel__head">
          <h3>Source health</h3>
          ${renderStatusPill("Connection", data.sourceStatus.connectionStatus)}
        </div>
        <div class="cp-kpi-grid">
          <div class="cp-kpi">
            <span>Source</span>
            <strong>${data.sourceStatus.sourceType}</strong>
          </div>
          <div class="cp-kpi">
            <span>Last sync</span>
            <strong>${data.sourceStatus.lastSyncAt ? formatAgo(Date.parse(data.sourceStatus.lastSyncAt)) : "never"}</strong>
          </div>
          <div class="cp-kpi">
            <span>Recency</span>
            <strong>${data.sourceStatus.recencyState}</strong>
          </div>
          <div class="cp-kpi">
            <span>Stale</span>
            <strong>${data.sourceStatus.isStale ? "yes" : "no"}</strong>
          </div>
        </div>
      </div>

      <div class="cp-panel">
        <div class="cp-panel__head">
          <h3>Metric cards</h3>
          <span class="cp-meta">${data.metrics.length} tracked</span>
        </div>
        <div class="cp-card-grid">
          ${
            data.metrics.length === 0
              ? html`<div class="cp-empty">No metrics have been synced yet.</div>`
              : data.metrics.map(
                  (metric) => html`
                    <article class="cp-metric-card">
                      <header>
                        <h4>${metric.metricType}</h4>
                        ${renderStatusPill("status", metric.stale ? "stale" : "fresh")}
                      </header>
                      <dl>
                        <div><dt>Connected source</dt><dd>${metric.connectedSourceStatus}</dd></div>
                        <div><dt>Enabled</dt><dd>${metric.enabled ? "yes" : "no"}</dd></div>
                        <div><dt>Permission</dt><dd>${metric.permissionState}</dd></div>
                        <div>
                          <dt>Latest observed</dt>
                          <dd>${metric.latestObservedAt ? formatAgo(Date.parse(metric.latestObservedAt)) : "n/a"}</dd>
                        </div>
                      </dl>
                    </article>
                  `,
                )
          }
        </div>
      </div>

      <div class="cp-panel">
        <div class="cp-panel__head">
          <h3>Active symptoms</h3>
          <span class="cp-meta">${data.activeSymptoms.length} active</span>
        </div>
        ${
          data.activeSymptoms.length === 0
            ? html`<div class="cp-empty">No active symptoms recorded.</div>`
            : html`
                <ul class="cp-symptom-list">
                  ${data.activeSymptoms.map(
                    (entry) => html`
                      <li>
                        <div>
                          <strong>${entry.symptom}</strong>
                          <span>${entry.severity ?? "severity unknown"}</span>
                        </div>
                        <span>
                          ${
                            entry.lastConfirmedAt
                              ? formatAgo(Date.parse(entry.lastConfirmedAt))
                              : "not confirmed"
                          }
                        </span>
                      </li>
                    `,
                  )}
                </ul>
              `
        }
      </div>
    </section>
  `;
}

function renderActions(props: CarePilotProps) {
  const actions = props.state?.actions ?? [];
  return html`
    <section class="cp-panel">
      <div class="cp-panel__head">
        <h3>Action timeline receipts</h3>
        <span class="cp-meta">${actions.length} events</span>
      </div>
      ${
        actions.length === 0
          ? html`<div class="cp-empty">No action receipts have been recorded yet.</div>`
          : html`
              <div class="cp-timeline">
                ${actions.map(
                  (action) => html`
                    <article class="cp-timeline-item cp-timeline-item--${statusTone(action.status)}">
                      <header>
                        <h4>${action.actionType}</h4>
                        ${renderStatusPill("status", action.status)}
                      </header>
                      <p class="cp-meta">
                        Started: ${action.startedAt ? formatAgo(Date.parse(action.startedAt)) : "n/a"}
                        ${action.finishedAt ? html`· Finished: ${formatAgo(Date.parse(action.finishedAt))}` : nothing}
                      </p>
                      <pre>${action.payloadSummary}</pre>
                      ${action.errorMessage ? html`<div class="callout danger">${action.errorMessage}</div>` : nothing}
                    </article>
                  `,
                )}
              </div>
            `
      }
    </section>
  `;
}

function renderSettings(props: CarePilotProps) {
  const data = props.state;
  const draft = props.onboardingDraft;
  const permissions = data ? Object.entries(data.settings.permissions) : [];

  return html`
    <section class="cp-grid cp-grid--settings">
      <div class="cp-panel">
        <div class="cp-panel__head">
          <h3>Permissions + proactive controls</h3>
          ${
            data
              ? renderStatusPill("Mode", data.settings.proactiveMode)
              : renderStatusPill("Mode", draft.proactiveMode)
          }
        </div>
        <div class="cp-form-grid">
          <label class="field">
            <span>Proactive mode</span>
            <select
              .value=${draft.proactiveMode}
              @change=${(event: Event) =>
                props.onDraftChange({
                  proactiveMode: (event.target as HTMLSelectElement)
                    .value as CarePilotProfileDraft["proactiveMode"],
                })}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="medication_only">Medication only</option>
            </select>
          </label>
          <label class="field">
            <span>Quiet hours start</span>
            <input
              type="time"
              .value=${draft.quietHoursStart}
              @input=${(event: Event) =>
                props.onDraftChange({ quietHoursStart: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>Quiet hours end</span>
            <input
              type="time"
              .value=${draft.quietHoursEnd}
              @input=${(event: Event) =>
                props.onDraftChange({ quietHoursEnd: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>Snooze days</span>
            <input
              type="number"
              min="0"
              .value=${draft.snoozeDays}
              @input=${(event: Event) =>
                props.onDraftChange({ snoozeDays: (event.target as HTMLInputElement).value })}
            />
          </label>
        </div>
        <div class="cp-actions-row">
          <button class="btn primary" ?disabled=${props.savingProfile} @click=${props.onSaveProfile}>
            ${props.savingProfile ? "Saving…" : "Save controls"}
          </button>
        </div>
      </div>

      <div class="cp-panel">
        <div class="cp-panel__head">
          <h3>Permission states</h3>
          <span class="cp-meta">${permissions.length} metrics</span>
        </div>
        ${
          permissions.length === 0
            ? html`<div class="cp-empty">No permission metadata available.</div>`
            : html`
                <ul class="cp-permission-list">
                  ${permissions.map(
                    ([metric, status]) => html`
                      <li>
                        <span>${metric}</span>
                        ${renderStatusPill("state", status)}
                      </li>
                    `,
                  )}
                </ul>
              `
        }
      </div>

      <div class="cp-panel">
        <div class="cp-panel__head">
          <h3>Privacy actions</h3>
          <span class="cp-meta">Backend receipts</span>
        </div>
        <div class="cp-actions-row">
          <button
            class="btn"
            ?disabled=${props.privacyBusy !== null}
            @click=${() => props.onRunPrivacy("export")}
          >
            ${props.privacyBusy === "export" ? "Requesting…" : "Export my data"}
          </button>
          <button
            class="btn danger"
            ?disabled=${props.privacyBusy !== null}
            @click=${() => props.onRunPrivacy("delete")}
          >
            ${props.privacyBusy === "delete" ? "Requesting…" : "Delete my data"}
          </button>
        </div>
        ${
          props.lastReceipt
            ? html`
                <div class="callout">
                  <strong>${props.lastReceipt.action === "export" ? "Export" : "Delete"} receipt</strong>
                  <div class="cp-meta">${props.lastReceipt.receiptId}</div>
                  <div class="cp-meta">${formatAgo(Date.parse(props.lastReceipt.requestedAt))}</div>
                  <div>${props.lastReceipt.message}</div>
                </div>
              `
            : nothing
        }
        ${
          data
            ? html`
                <div class="cp-meta" style="margin-top: 10px;">
                  Last export: ${data.settings.lastExportRequestedAt ?? "not requested"}<br />
                  Last delete request: ${data.settings.lastDeleteRequestedAt ?? "not requested"}
                </div>
              `
            : nothing
        }
      </div>
    </section>
  `;
}

export function renderCarePilot(props: CarePilotProps) {
  const state = props.state;
  return html`
    <section class="cp-shell ${props.activeSection === "chat" ? "cp-shell--chat" : ""}">
      <header class="cp-hero">
        <div class="cp-hero__title">
          <h2>CarePilot</h2>
          <p>Clinical-safe coordination surface driven by live plugin state.</p>
        </div>
        <div class="cp-hero__status">
          ${renderStatusPill("Gateway", props.connected ? "connected" : "offline")}
          ${
            state
              ? renderStatusPill("Onboarding", state.onboardingComplete ? "complete" : "pending")
              : renderStatusPill("Onboarding", "pending")
          }
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      ${renderSectionNav(props)}

      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}

      ${
        props.activeSection === "onboarding"
          ? renderOnboarding(props)
          : props.activeSection === "chat"
            ? renderChat(props)
            : props.activeSection === "dashboard"
              ? renderDashboard(props)
              : props.activeSection === "actions"
                ? renderActions(props)
                : renderSettings(props)
      }
    </section>
  `;
}

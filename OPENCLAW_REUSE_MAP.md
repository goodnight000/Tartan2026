# CarePilot <-> OpenClaw Reuse Map

How each CarePilot requirement maps to existing OpenClaw infrastructure, what can be reused as-is, what needs modification, and what must be built from scratch.

---

## 1. Memory System

### What OpenClaw provides
- **Markdown-based memory** stored in `~/.openclaw/memory/` (MEMORY.md + subdirectory files)
- **SQLite + sqlite-vec** backend with hybrid search (BM25 full-text + vector cosine similarity)
- **Embedding pipeline** supporting OpenAI and Google Gemini batch APIs
- **Chunking** with configurable token size (default 256) and overlap (default 32)
- **Tools**: `memory_search` (hybrid semantic search) and `memory_get` (pull specific lines)
- **Auto-indexing** of markdown files with filesystem watching

### What CarePilot needs
| Need | OpenClaw Coverage | Work Required |
|------|------------------|---------------|
| Conversational memory (preferences, past interactions, lifestyle) | Fully covered | None - use as-is |
| Clinical profile (structured: conditions, meds, allergies, labs) | Partially covered - OpenClaw stores unstructured markdown | Create a structured `clinical-profile.md` format and two custom tools: `clinical_profile_get` (parse structured sections) and `clinical_profile_update` (write to specific sections) |
| Cross-session persistence | Fully covered | None |
| Semantic search over health history | Fully covered by hybrid search | None - use as-is |
| Medication tracking with dates/quantities | Not covered - no structured date/quantity tracking | Build as part of clinical profile schema. Medication entries need: name, dosage, frequency, fill date, quantity, pharmacy, prescriber |

### Implementation approach
- **Layer 1 (clinical profile)**: Create `memory/clinical-profile.md` with strict markdown heading structure. Build `clinical_profile_get` and `clinical_profile_update` as plugin tools that read/write specific sections. OpenClaw's indexer will automatically pick up changes for search.
- **Layer 2 (conversational)**: Use OpenClaw's memory system unchanged. It already handles conversational context, preferences, and interaction history.

### Key files to study
- `/src/memory/manager.ts` - Memory index manager
- `/src/memory/hybrid.ts` - Hybrid search implementation
- `/src/memory/internal.ts` - Markdown chunking logic
- `/src/agents/tools/memory-tool.ts` - Tool definitions for memory_search and memory_get
- `/src/config/types.memory.ts` - Memory configuration schema

---

## 2. Proactive Features (Cron + Heartbeat)

### What OpenClaw provides

**Heartbeat system** (`/src/infra/heartbeat-runner.ts`):
- Periodic agent wake-up on configurable schedule (`every: "24h"`, `"6h"`, etc.)
- Custom prompt per heartbeat
- Active hours restriction (e.g., `"09:00-18:00"`)
- Delivery target control (`"last"`, `"main"`, or specific session)
- Hidden-from-user mode (runs silently) or indicator mode (shows visual signal)

**Cron system** (`/src/cron/`):
- Full cron expression support (standard Unix + extended)
- Job store in JSON/JSONL (SQLite-backed)
- Tool: `cron` with actions: add, list, remove, update, run, wake
- Concurrent execution control
- Job context: can include recent message history
- Delivery routing to any configured messaging channel

### What CarePilot needs
| Need | OpenClaw Coverage | Work Required |
|------|------------------|---------------|
| Medication refill reminders | Cron system covers scheduling; needs custom logic to calculate run-out dates | Build a daily cron job that reads clinical-profile.md, computes days-until-empty for each medication, triggers a message if <= 5 days |
| Appointment reminders (24h before) | Cron system can schedule one-off jobs | Build logic that creates a cron job when an appointment is booked |
| Follow-up nudges ("did you schedule that blood test?") | Heartbeat can handle periodic check-ins; cron for specific delays | Build a `care_reminder_set` tool that creates a cron job with a specific prompt like "follow up on blood test recommendation" |
| Seasonal health alerts | Cron weekly job + condition-aware prompt | Build a weekly cron that cross-references user conditions with a seasonal health calendar |
| Quiet hours / message frequency limits | Active hours already supported in heartbeat config | Configure `activeHours` in heartbeat. May need additional rate-limiting logic for cron-triggered messages |
| User opt-out ("stop reminders") | Not built-in - needs a toggle | Add a config flag or memory entry the agent checks before sending proactive messages |

### Implementation approach
- **Heartbeat**: Enable with `every: "12h"`, `activeHours: "08:00-21:00"`, custom prompt: "Check clinical profile for any upcoming medication refill dates, appointment reminders, or health follow-ups that need attention. Only message if something actionable exists."
- **Cron jobs**: The agent itself can create cron jobs via the `cron` tool when it books appointments or sets follow-ups. No custom scheduler code needed.
- **Refill calculator**: This is the one piece of custom logic needed - a tool that reads medication fill dates and quantities from the clinical profile and returns days remaining.

### Key files to study
- `/src/infra/heartbeat-runner.ts` - Heartbeat implementation
- `/src/cron/service/` - Cron scheduler service
- `/src/agents/tools/cron-tool.ts` - Cron tool definition
- `/src/config/types.cron.ts` - Cron configuration

---

## 3. Agent/Tool System

### What OpenClaw provides
- **Tool registration** via plugin API (`OpenClawPluginToolFactory`)
- **JSON schema** validation using TypeBox or Zod
- **Tool policy** system with allowlist/blocklist per agent
- **Execution pipeline**: before_tool_call hook -> execute -> tool_result_persist -> after_tool_call
- **Built-in tools**: web-fetch, web-search, bash, browser automation, message sending, cron management, memory search

### CarePilot custom tools to build

| Tool | Purpose | Complexity | Dependencies |
|------|---------|-----------|-------------|
| `triage_assess` | Emergency detection on every message | Low | Keyword/pattern matching, no external API |
| `clinical_profile_get` | Read structured clinical data | Low | File read + markdown parsing |
| `clinical_profile_update` | Write to specific sections of clinical profile | Low | File read/write + markdown manipulation |
| `appointment_search` | Find nearby labs/clinics/doctors | Medium | Google Places API |
| `appointment_book` | Book an appointment (simulated for hackathon) | Low-Medium | Simulated API or web automation |
| `pharmacy_search` | Find nearby pharmacies | Medium | Google Places API (same pattern as appointment_search) |
| `medication_refill` | Request a pharmacy refill | Low | Simulated for hackathon |
| `care_reminder_set` | Schedule a follow-up check-in | Low | Wraps the existing `cron` tool |
| `medication_refill_check` | Calculate days until medication runs out | Low | Reads clinical profile, does date math |

### What can be reused vs built
- **Reuse entirely**: web-fetch, web-search (for health info lookups), message tool (for multi-channel delivery), cron tool (for scheduling), memory tools (for context retrieval), browser tool (for appointment booking web automation)
- **Adapt**: Tool policy configuration (restrict to health-only tools)
- **Build new**: All 9 CarePilot-specific tools listed above (all are relatively simple - most are file operations + API calls)

### Key files to study
- `/src/agents/tools/` - All existing tool implementations (patterns to follow)
- `/src/agents/tool-policy.ts` - Tool policy system
- `/src/plugins/types.ts` - Plugin tool factory type definitions

---

## 4. Hooks System

### What OpenClaw provides
- **before_tool_call** - Intercept and modify/block tool calls (sequential)
- **after_tool_call** - React to completed tools (parallel)
- **before_agent_start** - Inject system prompt and context (sequential)
- **message_received** - Process incoming messages (parallel)
- **message_sending** - Modify/cancel outgoing messages (sequential)
- **tool_result_persist** - Transform transcript entries (sequential)
- Plus session lifecycle and gateway hooks

### CarePilot hook usage

| Hook | CarePilot Use | Purpose |
|------|------------|---------|
| `before_agent_start` | Inject clinical profile into system prompt | Every conversation starts with full medical context |
| `before_tool_call` | Consent gate for transactional tools | Block `appointment_book`, `medication_refill` unless user explicitly confirmed |
| `before_tool_call` | Audit logging | Log every tool call with timestamp, parameters, and session info |
| `message_received` | Emergency triage | Run triage_assess on every incoming message before agent processes it |
| `message_sending` | Disclaimer injection | Append medical disclaimer to first message of each session |
| `after_tool_call` | Memory update trigger | After booking or refill, automatically update clinical profile |

### Implementation approach
All hooks are registered in the CarePilot plugin. No modification to OpenClaw core needed.

### Key files to study
- `/src/plugins/hooks.ts` - Hook system implementation
- Extension examples that use hooks (check `extensions/` for `registerHook` usage)

---

## 5. System Prompt

### What OpenClaw provides
- Multi-section system prompt builder (`/src/agents/system-prompt.ts`)
- Sections: identity, time, preferences, memory recall, messaging, skills, docs, tooling
- Per-agent override via `agents.list[].identity.systemPromptOverride`
- Plugin injection via `before_agent_start` hook

### CarePilot approach
- **Do not modify** the OpenClaw system prompt builder
- **Use `before_agent_start` hook** to prepend CarePilot-specific instructions:
  - "You are CarePilot, a personal AI family doctor..."
  - Clinical profile data (injected from `clinical_profile_get`)
  - Safety rules (never diagnose, always redirect emergencies, cite uncertainty)
  - Tone guidelines (warm but professional, specific, transparent)
- **Use a SKILL.md file** for detailed health domain instructions (OpenClaw's skill system loads these automatically)

---

## 6. Messaging Channels

### What OpenClaw provides
Built-in support for: WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Google Chat, Line, MS Teams (via extension), Matrix, and more. Plus a WebChat UI.

### CarePilot recommendation
| Channel | Hackathon Use | Notes |
|---------|--------------|-------|
| **WebChat** (built-in UI) | Primary dev/demo channel | Easiest to set up, no external accounts needed, works in browser |
| **Telegram** | Secondary demo channel | Impressive to show on phone, free bot API, quick setup |
| **WhatsApp** | Stretch goal | Most impressive for judges ("it texts me on WhatsApp!") but requires Baileys pairing which can be flaky |

No channel code needs to be written. Just configure the channel auth tokens.

### Key files to study
- `/src/web/` or `/ui/` - WebChat UI
- `/extensions/telegram/` - Telegram channel plugin
- Channel configuration in `/src/config/`

---

## 7. Plugin Architecture (CarePilot as a Plugin)

### Recommended structure

CarePilot should be a single OpenClaw plugin. Based on the plugin system:

```
extensions/carepilot/
  openclaw.plugin.json    # Plugin manifest (id, config schema, tools, hooks)
  index.ts                # Plugin entry point
  tools/
    triage.ts             # Emergency detection
    clinical-profile.ts   # Get/update structured health data
    appointment.ts        # Search + book appointments
    pharmacy.ts           # Search pharmacies
    medication.ts         # Refill request + refill check
    care-reminder.ts      # Schedule follow-up reminders
  hooks/
    safety-gate.ts        # before_tool_call consent + audit
    context-loader.ts     # before_agent_start clinical profile injection
    triage-hook.ts        # message_received emergency detection
  prompts/
    system-prompt.md      # CarePilot persona and instructions
    onboarding.md         # Guided intake conversation flow
  data/
    seasonal-health.json  # Seasonal health risk calendar
    emergency-keywords.json  # Triage trigger patterns
  SKILL.md                # Health domain skill guide (auto-loaded by OpenClaw)
```

### What the plugin manifest needs
```json
{
  "id": "carepilot",
  "name": "CarePilot - Personal AI Family Doctor",
  "kind": "extension",
  "tools": [
    "triage_assess",
    "clinical_profile_get",
    "clinical_profile_update",
    "appointment_search",
    "appointment_book",
    "pharmacy_search",
    "medication_refill",
    "medication_refill_check",
    "care_reminder_set"
  ]
}
```

---

## 8. What Requires NO OpenClaw Core Changes

Everything listed above can be implemented purely as a plugin. No need to fork or modify OpenClaw's core code. This is important because:
- Faster development (no learning OpenClaw internals deeply)
- Easier to update if OpenClaw releases new versions
- Clean separation of concerns
- The plugin API provides everything CarePilot needs

---

## 9. External APIs Needed (Not from OpenClaw)

| API | Purpose | Free Tier | Hackathon Notes |
|-----|---------|----------|----------------|
| Google Places API | Find labs, clinics, pharmacies by location | $200/month free credit | Need a Google Cloud project + API key |
| Google Maps Geocoding | Convert addresses to lat/lng for proximity search | Included with Places | Same API key |
| OpenAI or Gemini Embeddings | Memory vector search | OpenAI: pay-per-use; Gemini: free tier | Needed for OpenClaw's memory system |
| LLM Provider (Claude or GPT-4) | Core reasoning | Pay-per-use | Team needs API key with sufficient credits |

For the hackathon, you could also skip Google Places entirely and use **simulated location data** (hardcoded nearby results) to avoid API setup overhead. The demo is about the flow, not the API call.

---

## 10. Effort Estimate Summary

| Category | Items | Effort | Can reuse from OpenClaw? |
|----------|-------|--------|------------------------|
| Memory (conversational) | Persistence, search, indexing | None | 100% reuse |
| Memory (clinical profile) | Structured health data store | Low | ~70% reuse (add structured layer on top of existing markdown memory) |
| Proactive (heartbeat) | Periodic check-ins | Config only | 100% reuse (just configure) |
| Proactive (cron) | Medication reminders, appointment reminders | Low | ~90% reuse (existing cron system + thin logic layer) |
| Agent tools | 9 custom health tools | Medium | ~30% reuse (follow existing tool patterns, but logic is new) |
| Hooks | Safety gate, consent, triage, context loading | Low | ~80% reuse (hook system exists, just register handlers) |
| System prompt | Health persona + safety rules | Low | ~60% reuse (injection via existing hook, but content is new) |
| Channels | WhatsApp/Telegram/WebChat | Config only | 100% reuse |
| UI | Chat interface | None | 100% reuse (WebChat or mobile channel) |
| Appointment booking | Simulated booking flow | Low | New, but simple |

**Bottom line**: OpenClaw provides roughly 60-70% of what CarePilot needs out of the box. The remaining 30-40% is health-specific domain logic packaged as a plugin.

---

## 11. Risks and Gotchas

| Risk | Detail | Mitigation |
|------|--------|-----------|
| OpenClaw setup complexity | Large monorepo with many dependencies; pnpm workspace with multiple packages | Dedicate one person to setup early. Follow CONTRIBUTING.md closely. |
| Memory embedding costs | Vector search requires an embedding API (OpenAI/Gemini) | Can use Gemini free tier, or disable vector search and rely on BM25 keyword search only |
| Heartbeat timing for demo | Hard to show a "proactive" message live if the heartbeat interval is long | Pre-trigger the heartbeat manually during demo, or use a very short interval (e.g., `every: "30s"`) for demo purposes |
| Clinical profile parsing | Structured markdown is fragile if the LLM writes it in unexpected formats | Use strict section headers and validation in the `clinical_profile_update` tool |
| Google Places API rate limits | Free tier has daily limits | Pre-cache results for demo locations. Have fallback hardcoded data. |
| LLM health hallucinations | Model may fabricate medical facts | Strong system prompt guardrails + ground all specific claims in clinical profile data |

---

## 12. Recommended First Steps

1. **Get OpenClaw running locally** - Clone, install deps, verify the gateway starts and WebChat works
2. **Create the CarePilot plugin skeleton** - `openclaw.plugin.json` + `index.ts` with one dummy tool
3. **Write the clinical profile schema** - Define the markdown format for `clinical-profile.md`
4. **Write the system prompt** - CarePilot persona, safety rules, tone guidelines
5. **Build `clinical_profile_get` and `clinical_profile_update`** - Core memory tools
6. **Build `triage_assess`** - Safety-first
7. **Test the onboarding flow** - Guided intake conversation
8. **Build `appointment_search`** (or simulated version) - The flagship demo action
9. **Configure heartbeat for medication reminders** - Proactive care
10. **Rehearse the demo flow end-to-end**

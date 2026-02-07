# CareBase - LLM Persistent Memory System

Please update this document proactively as the project progresses, ensuring it remains an accurate and comprehensive guide for developers and agents interacting with the CareBase system.

Please also log any major design decisions, architectural changes, or important implementation details in this document to make sure later developers can easily understand the rationale behind them.

Please actively test the system while developing, and document any edge cases, limitations, or known issues that arise during testing. Early testing can reveal important insights that can inform better design and implementation choices.

## Project Overview

CareBase is a cross-agent, cross-session shared local database system designed to store user's **personal information, health, fitness, medical, and medical history** data. All LLM Agents can access this database through a unified interface, enabling persistent data storage and sharing.

### Core Features

- **Natural Language Storage**: Both keys and values are stored in human-readable natural language format (no embedding vectors)
- **Unified Access Interface**: All Agents interact with the database through formalized prompts
- **Dataflow Guard**: Fine-grained user authorization control
- **End-to-End Encryption**: Each data entry is independently encrypted, supporting selective decryption sharing
- **Cloud Sync**: Supports backup and cross-device synchronization

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend Framework | Next.js + React |
| Local Storage | localStorage + IndexedDB |
| Cloud Framework | Next.js |
| Cloud Database | SQLite |
| Encryption Algorithms | AES-128-GCM, AES-CMAC |
| Test Agent | Claude API |

---

## Project Structure

```
carebase/
├── app/                    # Next.js App Router
│   ├── page.tsx            # 主页面
│   ├── api/                # API 路由
│   │   └── cloud/          # CareBase Cloud API
│   └── layout.tsx
├── components/             # React Components
│   ├── DataflowGuard/      # Dataflow protection modal
│   ├── AgentChat/          # Test Agent chat interface
│   └── KeyManager/         # Key management UI
├── lib/                    # Core Libraries
│   ├── carebase/           # CareBase Core
│   │   ├── database.ts     # IndexedDB operations
│   │   ├── parser.ts       # Prompt parser
│   │   ├── encryption.ts   # Encryption/Decryption module
│   │   └── types.ts        # Type definitions
│   ├── rfc1751/            # RFC1751 key-to-english
│   └── cloud/              # Cloud sync logic
├── docs/                   # Documentation
│   └── AGENT_GUIDE.md      # Agent usage guide (include in Agent context)
└── public/
```

---

## Agent Interaction Protocol

### Data Access Pipeline

```
User Prompt → Third-party Agent → Agent Response → CareBase Parser
                                                        ↓
                              ┌─────────────────────────┴─────────────────────────┐
                              ↓                                                   ↓
                    Has CareBase Commands                              No CareBase Commands
                              ↓                                                   ↓
                    Execute & Return Results                           Conversation Ends
                              ↓
                    Agent Continues Processing
```

CareBase now runs on every agent response (even without commands). If CareBase returns responses, those are fed back to the agent to continue the loop until no CareBase responses are produced.

### Supported Commands

#### 1. FETCH - Retrieve Data

```xml
<carebase-fetch>data-key</carebase-fetch>
```

**Response Format**:
```xml
<carebase-resp: data-key>data content</carebase-resp>
```

**Error Responses**:
```xml
<carebase-resp: data-key>Error: non-existence key</carebase-resp>
<carebase-resp: data-key>Error: permission denied by user</carebase-resp>
```

#### 2. STORE - Store/Update Data

```xml
<carebase-store: data-key>data content</carebase-store>
```

**Response Format**:
```xml
<carebase-resp: data-key>Success: stored</carebase-resp>
<carebase-resp: data-key>Error: storage failed</carebase-resp>
```

#### 3. DELETE - Delete Data

```xml
<carebase-delete>data-key</carebase-delete>
```

**Response Format**:
```xml
<carebase-resp: data-key>Success: deleted</carebase-resp>
<carebase-resp: data-key>Error: non-existence key</carebase-resp>
```

#### 4. LIST - List All Data Entries

```xml
<carebase-list></carebase-list>
```

**Response Format**:
```xml
<carebase-resp: list>key1, key2, key3, ...</carebase-resp>
```

#### 5. QUERY - Fuzzy Search (Optional)

```xml
<carebase-query>search keywords</carebase-query>
```

**Response Format**:
```xml
<carebase-resp: query>matching-key1: data summary, matching-key2: data summary, ...</carebase-resp>
```

---

## Core Features

### 1. Dataflow Guard

Each data entry has a **Sensitivity Level**:

| Level | Behavior |
|-------|----------|
| `Ask` | Requires user confirmation for each access (default) |
| `Allow` | Automatically allows access |

#### User Authorization Modal

When an Agent requests access to data with `Ask` level, display a modal:

```
┌─────────────────────────────────────────────────────┐
│  🔒 Data Access Request                              │
│                                                       │
│  Agent requests access to: [data-key-name]            │
│                                                       │
│  ┌─────────┐ ┌─────────┐ ┌──────────────┐ ┌──────────┐ │
│  │  Allow  │ │  Deny   │ │ Always Allow │ │View Context│ │
│  └─────────┘ └─────────┘ └──────────────┘ └──────────┘ │
└─────────────────────────────────────────────────────┘
```

#### Option Behaviors

| Option | Current Access | Sensitivity Level Change |
|--------|----------------|-------------------------|
| Allow | Granted | No change (remains Ask) |
| Deny | Denied | No change (remains Ask) |
| Always Allow | Granted | Changed to Allow |
| View Context | Show full Agent context, then choose | - |

### 2. Granular Encryption

#### Key Hierarchy

```
Master Key (|M|)
    │
    ├── AES-CMAC(|M|, "key-1") → Encryption Key 1 → Encrypt Data 1
    │
    ├── AES-CMAC(|M|, "key-2") → Encryption Key 2 → Encrypt Data 2
    │
    └── AES-CMAC(|M|, "key-N") → Encryption Key N → Encrypt Data N
```

#### Encryption Flow

1. **First-time Initialization**: Generate 128-bit random Master Key `|M|`, store in localStorage
2. **Storing Data**:
   - Use `AES-CMAC(|M|, |K|)` to generate the Encryption Key for this data
   - Use `AES-128-GCM` to encrypt the data content
   - Store encrypted data (Encryption Key is NOT stored)
3. **Accessing Data**:
   - Recompute `AES-CMAC(|M|, |K|)` to get Encryption Key
   - Use `AES-128-GCM` to decrypt data

#### Customer Support API

Users can generate Encryption Keys for specific data entries to share with support staff, without exposing the Master Key:

```typescript
// Generate Encryption Key for a specific data entry
function generateEncryptionKey(masterKey: Uint8Array, dataKey: string): Uint8Array

// Decrypt data using Encryption Key
async function decryptWithKey(
  encryptedData: Uint8Array,
  encryptionKey: Uint8Array
): Promise<string>
```

---

## CareBase Cloud

### Features

- **Automatic Backup**: Periodically backup local encrypted database to cloud
- **Cross-device Sync**: Auto-sync database after logging in on new device
- **Zero-knowledge Storage**: Cloud only stores encrypted data, cannot decrypt

### New Device Login Flow

```
Old Device                        New Device
     │                                 │
     │  Display Master Key             │
     │  (QR Code or RFC1751 phrase)    │
     │                                 │
     │ ───────────────────────────────→│ Scan QR / Manual Input
     │                                 │
     │                                 │  Use Master Key to decrypt
     │                                 │  synced database
```

### RFC1751 Key Representation

To facilitate manual input of 128-bit Master Key, use RFC1751 standard to convert it to human-readable English phrases:

```
Raw Key:  0xEB33F77EE73D4053...
RFC1751:  TIDE ITCH SLOW REIN RULE MOT
```

---

## Database Schema

### IndexedDB Structure

```typescript
interface CareBaseRecord {
  key: string;                    // Data key (natural language)
  encryptedValue: Uint8Array;     // Encrypted data content
  sensitivityLevel: 'Ask' | 'Allow';
  createdAt: number;              // Creation timestamp
  updatedAt: number;              // Update timestamp
  syncedAt?: number;              // Last sync timestamp
}
```

### localStorage Structure

```typescript
interface LocalStorageSchema {
  'carebase-master-key': string;  // Base64 encoded Master Key
  'carebase-initialized': boolean;
  'carebase-last-sync': number;
}
```

---

## Development Task List

### Phase 1: Foundation

- [x] Initialize Next.js project
- [x] Implement IndexedDB wrapper layer
- [x] Implement Prompt parser (support fetch, store, delete, list)
- [x] Implement basic database CRUD operations

### Phase 2: Encryption System

- [x] Implement Master Key generation and storage
- [x] Implement AES-CMAC key derivation
- [x] Implement AES-128-GCM encryption/decryption
- [x] Implement RFC1751 key-to-english / english-to-key

### Phase 3: Dataflow Guard

- [x] Implement Sensitivity Level management
- [x] Implement user authorization modal component
- [x] Implement View Context feature
- [x] Integrate into data access flow

### Phase 4: Test Agent

- [x] Implement Claude API integration
- [x] Create test chat interface
- [x] Write Agent usage guide documentation

### Phase 5: CareBase Cloud

- [x] Implement cloud API (Next.js + SQLite)
- [x] Implement automatic backup feature
- [x] Implement cross-device sync
- [x] Implement QR code / manual Master Key input

### Phase 6: Support Tools

- [x] Implement Encryption Key generation UI
- [x] Implement standalone decryption UI

---

## Documentation List

| Document | Purpose | Location |
|----------|---------|----------|
| CLAUDE.md | Project development guide (this document) | Project root |
| AGENT_GUIDE.md | Complete guide for Agents using CareBase | docs/ |
| API.md | API reference documentation | docs/ |

---

## Environment Variables

```env
# .env.local
ANTHROPIC_API_KEY=your-claude-api-key
ANTHROPIC_MODEL=claude-sonnet-4-5

# .env (Cloud)
DATABASE_URL=file:./carebase.db
```

---

## Commands

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Start production server
npm run start

# Run tests
npm run test
```

---

## Important Notes

1. **Security**: Master Key must NEVER be uploaded to server or exposed to any third party
2. **Data Format**: All keys and values must be human-readable natural language
3. **User Experience**: Dataflow Guard modal should be clean and minimal, avoid interrupting user flow
4. **Compatibility**: Ensure IndexedDB and localStorage are available in target browsers
5. **Offline Support**: Core features should work in offline mode

---

## Progress Log (2026-02-07)

### Implemented
- Initialized Next.js App Router project scaffold.
- Added CareBase foundation modules: IndexedDB wrapper, command parser, types, encryption scaffolding.
- Added unit testing setup with Vitest + fake-indexeddb and initial parser/database tests.
- Updated landing page UI to reflect project status.
- Implemented AES-CMAC key derivation using `@noble/ciphers` and AES-128-GCM encryption/decryption via Node crypto (tests) and Web Crypto (browser).

### Design Decisions
- Parser uses a single ordered regex pass to preserve command order while stripping CareBase tags.
- IndexedDB wrapper intentionally minimal (open per operation) to reduce shared state complexity during early development.
- Encryption uses `@noble/ciphers` CMAC implementation; AES-128-GCM is used for authenticated encryption in both Node crypto (tests) and Web Crypto (browser).

### Testing Notes
- `vitest run` covers parser extraction/strip behavior and IndexedDB CRUD with fake-indexeddb.
- Added AES-CMAC vector test and AES-128-GCM round-trip test.

---

## Progress Log (2026-02-07) - Dataflow Guard

### Implemented
- Added Dataflow Guard modal component with Allow/Deny/Always Allow actions and optional context reveal.
- Built a demo workflow that parses CareBase commands, stores encrypted records, and gates fetches through the Dataflow Guard.
- Added a client-side demo UI for running commands and inspecting execution logs.

### Design Decisions
- Guard decisions are resolved via a promise-based modal flow in the demo to keep command execution sequential.
- Sensitivity defaults to `Ask` and is upgraded to `Allow` only through the Always Allow action.

### Testing Notes
- No automated UI tests yet for the Dataflow Guard modal; manual verification recommended in `npm run dev`.

---

## Progress Log (2026-02-07) - RFC1751

### Implemented
- Added RFC1751 wordlist and encoder/decoder helpers.
- Added tests covering RFC1751 examples from the RFC (128-bit encode/decode).

### Design Decisions
- Encoder/decoder supports 8-byte (6 words) and 16-byte (12 words) inputs, matching RFC1751 usage.

---

## Progress Log (2026-02-07) - Test Agent

### Implemented
- Added `/api/agent` route that proxies Anthropic Messages API for a CareBase test agent.
- Added a lightweight chat UI component for sending test prompts and viewing responses.

### Notes
- API route reads `ANTHROPIC_API_KEY` and optional `ANTHROPIC_MODEL` from environment variables.

---

## Progress Log (2026-02-07) - Agent Guide

### Implemented
- Added `docs/AGENT_GUIDE.md` describing CareBase command tags, responses, Dataflow Guard, and authoring guidelines.

---

## Progress Log (2026-02-07) - Pipeline Orchestration

### Implemented
- Added CareBase engine to parse and execute commands on every agent response.
- Agent chat now loops: user → agent → CareBase → (if responses) agent → ... until no CareBase responses.
- Dataflow Guard is integrated into the agent loop for `Ask` sensitivity records.

---

## Progress Log (2026-02-07) - Agent Context

### Implemented
- Injected current CareBase key list and absolute-time storage rules into the agent system prompt.
- Dataflow Guard now always renders a context block, with a fallback when context is missing.

---

## Progress Log (2026-02-07) - CareBase Cloud

### Implemented
- Added SQLite-backed cloud data layer (`lib/cloud`) with schema init and record CRUD.
- Added cloud API routes for records and sync metadata.
- Added client-side push/pull sync helpers and a simple UI panel for manual sync.

### Notes
- Sync endpoints are unauthenticated and intended for local prototyping only.

---

## Progress Log (2026-02-07) - Master Key Transfer

### Implemented
- Added Master Key panel with QR code, RFC1751 phrase, and manual input for Base64/RFC1751.
- Integrated master key transfer UI into the main page.

---

## Progress Log (2026-02-07) - Support Tools

### Implemented
- Added support tools panel for deriving encryption keys and standalone decryption.
- Integrated support tools UI into the main page.

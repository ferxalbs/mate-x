# agents.md — MaTE X Agent Architecture

> **Documento de diseño y orden interno. Uso privado — no distribuir.**  
> MaTE X es una aplicación Desktop (Electron + Vite + React) para revisión de código local, detección de vulnerabilidades de seguridad y asistencia técnica avanzada. Es una herramienta **privada y de uso personal**, no es open-source.

---

## ¿Qué es MaTE X?

MaTE X es un agente local poderoso que actúa como copiloto de código directamente en tu máquina. Tiene acceso completo al repositorio activo, puede leer archivos, ejecutar búsquedas semánticas, analizar el estado de Git e interactuar con un modelo de lenguaje de alto rendimiento para razonar sobre el código fuente.

Su caso de uso central es la **revisión de código en búsqueda de vulnerabilidades de seguridad**, aunque su arquitectura lo habilita para asistencia de desarrollo general (debug, refactor, explicación de código, análisis de dependencias, etc.).

---

## Stack Técnico

| Capa | Tecnología |
|------|-----------|
| Desktop runtime | Electron 41 (Electron Forge) |
| Renderer | React 19 + Vite 8 |
| Routing | TanStack Router v1 |
| Estado | Zustand v5 |
| UI primitives | Base UI (Radix-compatible) + Tailwind CSS v4 |
| Estilo | Tailwind CSS v4 (utility) + CSS Modules (componentes) |
| Git integration | simple-git v3 + execFile (rg / ripgrep para búsqueda) |
| AI provider | **Rainy API v3** (formato OpenAI-compatible — ver sección AI Provider) |
| IPC bridge | Electron contextBridge + ipcMain/ipcRenderer |
| Type safety | TypeScript ~6 |
| Package manager | Bun |

---

## AI Provider — Rainy API v3

MaTE X consume el modelo de lenguaje a través de **Rainy API v3**, una API privada compatible con el formato de la OpenAI API (mismo esquema de requests/responses, mismo SDK de `openai` en Node.js).

### Configuración

```ts
// src/electron/repo-service.ts (main process)
const client = new OpenAI({
  apiKey: process.env.RAINY_API_KEY,
  baseURL: process.env.RAINY_API_BASE_URL, // e.g. https://api.rainy.dev/v3
});
```

> Las variables de entorno `RAINY_API_KEY` y `RAINY_API_BASE_URL` deben configurarse localmente.  
> **Nunca se hardcodean.** El archivo `.env` está en `.gitignore`.

### Por qué Rainy API v3

- Compatibilidad total con el SDK `openai` de Node.js (mismo `client.chat.completions.create` / `client.responses.create`)
- Sin necesidad de un SDK propietario adicional
- Modelos más capaces para razonamiento de código y seguridad
- API privada — sin exposición pública de rate limits ni costos de terceros

---

## Arquitectura del Agente

El agente de MaTE X sigue un pipeline de 4 fases por cada petición del usuario:

```
Usuario (prompt)
    │
    ▼
[1] Snapshot Collection          ← main process (repo-service.ts)
    ├── Workspace metadata (path, branch, stack)
    ├── File inventory (rg --files, hasta 200 archivos)
    ├── Git status (simple-git)
    ├── package.json (para detectar stack)
    └── Prompt-linked search (rg -n con términos del prompt)
    │
    ▼
[2] Context Assembly             ← buildSystemPrompt() / requestRainyResponse()
    ├── System prompt: rol de agente de seguridad
    ├── Workspace context (nombre, path, branch, stack)
    ├── File list (primeros 80 archivos)
    ├── Git status (primeros 40 líneas)
    ├── Prompt matches (primeros 12 matches del rg)
    └── Historial de conversación
    │
    ▼
[3] Rainy API v3 Request         ← OpenAI-compatible API call
    ├── model: RAINY_MODEL env var (default: 'rainy-coder-security')
    ├── messages: [system, user]
    ├── stream: true (para streaming en tiempo real)
    └── timeout: 20s
    │
    ▼
[4] Response + Tool Events       ← AssistantExecution contract
    ├── message.content (respuesta del modelo)
    ├── message.events[] (pasos ejecutados — visible en UI)
    └── message.artifacts[] (metadata: provider, model, branch, files)
```

---

## Estructura del Proyecto

```
mate-x/
├── src/
│   ├── electron/                   # Main process (Node.js)
│   │   ├── main.ts                 # Entry point Electron
│   │   ├── ipc-handlers.ts         # Registro de todos los canales IPC
│   │   ├── repo-service.ts         # Core: snapshot, search, AI request
│   │   ├── git-service.ts          # Git operations (simple-git)
│   │   └── workspace-registry.ts   # Gestión de workspaces (JSON persist)
│   │
│   ├── contracts/                  # TypeScript interfaces (shared)
│   │   ├── chat.ts                 # ChatMessage, Conversation, AssistantExecution
│   │   ├── audit.ts                # AuditFinding, AuditReport (seguridad)
│   │   ├── git.ts                  # GitStatus, GitCommit, GitDiff
│   │   ├── ipc.ts                  # RepoInspectorApi, GitApi (preload contract)
│   │   └── workspace.ts            # WorkspaceEntry, WorkspaceSnapshot
│   │
│   ├── features/
│   │   ├── desktop-shell/          # Shell raíz de la app (sidebar, header)
│   │   └── chat/                   # Panel de chat principal
│   │
│   ├── store/
│   │   ├── chat-store.ts           # Estado global del chat (Zustand)
│   │   └── git-store.ts            # Estado del panel Git
│   │
│   ├── services/                   # Renderer-side service façades
│   │   ├── repo-client.ts          # Llama a window.mate.repo.* (IPC bridge)
│   │   ├── assistant-service.ts    # Streaming wrapper (renderer side)
│   │   └── workspace-service.ts    # Workspace helpers renderer
│   │
│   ├── lib/
│   │   ├── openai.ts               # Cliente OpenAI-compat (renderer — para streaming)
│   │   └── id.ts                   # Generador de IDs únicos
│   │
│   ├── preload.ts                  # contextBridge — expone window.mate.repo y window.mate.git
│   └── router.tsx                  # TanStack Router routes
│
├── agents.md                       ← ESTE ARCHIVO
├── package.json
└── forge.config.ts
```

---

## Canales IPC Registrados

### `repo:*` — Workspace y AI

| Canal | Descripción |
|-------|-------------|
| `repo:bootstrap` | Carga el estado inicial del workspace activo |
| `repo:get-workspaces` | Lista todos los workspaces registrados |
| `repo:get-workspace-summary` | Resumen del workspace (branch, stack, facts) |
| `repo:set-active-workspace` | Cambia el workspace activo |
| `repo:remove-workspace` | Elimina un workspace del registro |
| `repo:open-workspace-picker` | Abre el diálogo del sistema para seleccionar carpeta |
| `repo:open-workspace-path` | Abre el workspace en Finder / VSCode |
| `repo:list-files` | Lista archivos con ripgrep |
| `repo:search` | Búsqueda semántica con ripgrep |
| `repo:run-assistant` | Ejecuta el pipeline completo del agente + Rainy API |

### `git:*` — Git Integration

| Canal | Descripción |
|-------|-------------|
| `git:status` | Estado del working tree |
| `git:log` | Log de commits recientes |
| `git:stage-files` | Stagear archivos específicos |
| `git:unstage` | Destagear archivos |
| `git:commit` | Crear commit |
| `git:push` | Push al remoto |
| `git:pull` | Pull del remoto |
| `git:diff` | Diff completo del working tree |

---

## Módulo de Auditoría de Seguridad

El contrato `AuditReport` (src/contracts/audit.ts) define la estructura de salida para las revisiones de seguridad:

```ts
interface AuditFinding {
  id: string;
  severity: 'critical' | 'warning' | 'note';
  title: string;
  summary: string;
  file: string;             // archivo afectado
  recommendation: string;   // acción concreta a tomar
}

interface AuditReport {
  id: string;
  createdAt: string;
  headline: string;
  summary: string;
  findings: AuditFinding[];
  checkedAreas: string[];   // áreas revisadas (auth, deps, IPC, etc.)
}
```

### Áreas de Revisión Previstas

El agente debe ser capaz de realizar auditorías en las siguientes áreas:

- **Dependencias** — CVEs en `package.json` / `Cargo.toml` / `requirements.txt`
- **Credenciales expuestas** — API keys, tokens, secrets hardcodeados
- **IPC surface** — Canales electron sin validación de input
- **Inyección de código** — eval(), Function(), deserialización insegura
- **Autenticación / Autorización** — Lógica de permisos débil o ausente
- **SSRF / Request forgery** — URLs construidas con input del usuario
- **Prototype pollution** — Mutación insegura de objetos
- **XSS en Electron** — Content sin sanitizar en webContents
- **Path traversal** — fs.readFile con paths construidos desde usuario
- **Node.js integration** — nodeIntegration / contextIsolation mal configurados

---

## Flujo de la Aplicación (UI)

```
App Launch
  └── bootstrap() → repo-service.ts → workspace-registry.ts
        └── Resuelve workspace activo (o crea uno semilla con process.cwd())
              └── Carga snapshot: archivos, branch, signals, workspaces
                    └── ChatStore inicializado
                          └── DesktopShell renderizado (sidebar + chat panel)
```

### Flujo de Chat (submitPrompt)

1. Usuario escribe prompt en el composer
2. `chat-store.ts:submitPrompt()` añade el mensaje de usuario al thread
3. Llama a `window.mate.repo.runAssistant(prompt, history)` via IPC
4. `repo-service.ts:runAssistant()` ejecuta el pipeline de 4 fases 
5. Retorna `AssistantExecution` con mensaje + eventos + artifacts
6. El store actualiza el thread con la respuesta del agente
7. UI renderiza la respuesta con markdown, tool events y badges

---

## Reglas del Agente (System Prompt)

El system prompt del agente define su identidad y comportamiento:

```
Eres MaTE X, un agente local de revisión de código especializado en seguridad.
Tu trabajo es analizar el repositorio activo, detectar vulnerabilidades,
malos patrones y riesgos de seguridad. Responde con precisión quirúrgica.
Si la evidencia en el repo es débil, dilo explícitamente y propón la siguiente
acción concreta (qué archivo abrir, qué buscar, qué comando ejecutar).
```

**Principios de diseño del agente:**
1. **Grounded** — Toda respuesta debe estar anclada en evidencia real del repo
2. **Actionable** — Cada hallazgo incluye una recomendación concreta
3. **Transparent** — Los tool events muestran exactamente qué pasos se ejecutaron
4. **Fail-fast** — Si falta el API key, la app lo dice con claridad y degrada con gracia

---

## Variables de Entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `RAINY_API_KEY` | API key para Rainy API v3 | ✅ Sí |
| `RAINY_API_BASE_URL` | Base URL de la API (e.g. `https://api.rainy.dev/v3`) | ✅ Sí |
| `RAINY_MODEL` | Modelo a usar (default: `rainy-coder-security`) | ⚙️ Opcional |

> Crear un archivo `.env` en la raíz del proyecto con estas variables.  
> El archivo `.env` **nunca** se commitea al repositorio.

---

## Roadmap de Features

### v1.0 — Base ✅
- [x] Workspace management multi-repo
- [x] Git integration completa (status, log, diff, stage, commit, push, pull)
- [x] Chat con historial por workspace y por thread
- [x] File inventory + semantic search con ripgrep
- [x] Tool events visibles en la UI
- [x] Stack detection automática

### v1.1 — Rainy API v3 Integration 🚧
- [ ] Migrar `repo-service.ts` de OpenAI API a Rainy API v3 (`baseURL` + `apiKey`)
- [ ] Migrar `lib/openai.ts` (renderer) a Rainy API v3
- [ ] Sistema de prompt de seguridad especializado
- [ ] Configuración de API key desde la UI (Settings panel)
- [ ] Streaming de respuestas en tiempo real

### v1.2 — Security Audit Engine 🗓️
- [ ] Comando `/audit` para iniciar una revisión completa
- [ ] Motor de análisis estático por patrones (regex + AST)
- [ ] Renderizado de `AuditReport` en UI dedicada
- [ ] Filtros por severidad (critical / warning / note)
- [ ] Export de reporte en Markdown / JSON
- [ ] Auditoría de dependencias (integration con `npm audit` / `cargo audit`)

### v1.3 — Deep Analysis 🗓️
- [ ] Lectura de archivos completos bajo demanda (no solo snippets)
- [ ] Análisis de flujo de datos (taint analysis básico)
- [ ] Comparación de diff pre/post para validar fixes
- [ ] Integración con GitHub PRs (lectura de PR diff)
- [ ] Historial de auditorías persistido por workspace

---

## Decisiones de Diseño

### ¿Por qué Electron y no Tauri?
El proyecto migró de Tauri (Rust) a Electron (Node.js) para simplificar la capa de integración con herramientas del sistema (Git, ripgrep, npm) y para tener acceso directo al SDK de OpenAI/Rainy sin puentes FFI.

### ¿Por qué el AI call está en el main process?
El main process (Node.js) tiene acceso a variables de entorno, al sistema de archivos y puede ejecutar comandos shell. Poner el AI call ahí mantiene el API key fuera del renderer (sandboxed) y permite ejecutar comandos de análisis de forma coordinada con la respuesta del modelo.

### ¿Por qué ripgrep para búsqueda?
`rg` es el estándar de facto para búsqueda en repositorios grandes. Es órdenes de magnitud más rápido que `grep` o los file walkers de Node.js y respeta `.gitignore` automáticamente.

### ¿Por qué Zustand para estado?
Zustand provee un store global con mínimo boilerplate, sin Provider hell, y con soporte nativo para acciones async. Es el complemento ideal para una app desktop donde el estado de la sesión no necesita serialización compleja.

---

## Convenciones

- Los archivos del **main process** viven en `src/electron/`
- Los archivos del **renderer** siguen feature-first: `src/features/<nombre>/`
- Los **contracts** (interfaces TypeScript) son el contrato explícito entre capas — nunca se importan directamente implementaciones cross-boundary
- Los canales IPC siguen el patrón `<dominio>:<acción>` (e.g. `repo:run-assistant`, `git:status`)
- Los IDs se generan con `createId(prefix)` de `src/lib/id.ts`
- Las fechas siempre se almacenan en ISO 8601 (`new Date().toISOString()`)

---

*Última actualización: 2026-04-16 — ferxalbs*

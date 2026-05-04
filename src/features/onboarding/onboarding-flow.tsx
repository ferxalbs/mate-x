import { useState, useEffect, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronRight, 
  Shield, 
  FolderOpen,
  GitBranch,
  Key,
  Lock,
  Route,
  CheckCircle2, 
  Download,
  ExternalLink,
  Settings,
  FileCheck2,
  Terminal,
  Pencil,
  Eye,
  PauseCircle,
  PlayCircle,
  Database,
  Activity,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { getAppSettings, updateAppSettings, getApiKey } from "../../services/settings-client";
import type { AppSettings, AppearancePreference, ThemePreference, TimeFormat } from "../../contracts/settings";
import type { PrivacyModelDownloadProgress } from "../../contracts/privacy";
import { useTheme } from "../../hooks/use-theme";

const steps = [
  { id: "welcome", title: "Welcome", description: "Local-first security verification.", cta: "Continue" },
  { id: "preferences", title: "General setup", description: "Make the interface feel controlled.", cta: "Save preferences" },
  { id: "privacy", title: "Privacy Sentinel", description: "Prepare local secret and PII checks.", cta: "Continue" },
  { id: "api-key", title: "Rainy API", description: "Enable AI reasoning and repo embeddings.", cta: "Continue" },
  { id: "workspace", title: "Connect workspace", description: "Build repo graph and validation context.", cta: "Select repository" },
  { id: "trust", title: "Set trust boundary", description: "Define what MaTE X can touch.", cta: "Configure policy" },
  { id: "verification", title: "First verification run", description: "Generate first evidence pack.", cta: "Start verification" },
];

const capabilityLine = ["Repo graph", "Privacy Sentinel", "Security Path Trace", "Evidence Pack"];

export function OnboardingFlow() {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [initialApiKey, setInitialApiKey] = useState<string | null>(null);
  const [privacyProgress, setPrivacyProgress] = useState<PrivacyModelDownloadProgress | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [policy, setPolicy] = useState({
    read: true,
    patch: false,
    commands: false,
    approval: true,
  });
  const navigate = useNavigate();
  const { setAppearance, setTheme } = useTheme();

  useEffect(() => {
    void getAppSettings().then(setSettings);
    void getApiKey().then((key) => {
      if (key) {
        setApiKey(key);
        setInitialApiKey(key);
      }
    });
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setDirection(1);
      setCurrentStep((s) => s + 1);
    } else {
      void handleFinish();
    }
  }, [currentStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const handleWorkspaceSelect = useCallback(async () => {
    try {
      const workspace = await window.mate.repo.openWorkspacePicker();
      if (workspace?.workspace) {
        setSelectedWorkspace(workspace.workspace.name || workspace.workspace.path || workspace.workspace.id);
      }
    } catch {
      setSelectedWorkspace(null);
    }
    setDirection(1);
    setCurrentStep(2);
  }, []);

  const handlePrimaryAction = useCallback(() => {
    if (currentStep === 1 && settings) {
      void updateAppSettings(settings);
    }
    if (currentStep === 3 && apiKey) {
      void window.mate.settings.setApiKey(apiKey);
    }
    if (currentStep === 4) {
      void handleWorkspaceSelect();
      return;
    }
    handleNext();
  }, [apiKey, currentStep, handleNext, handleWorkspaceSelect, settings]);

  const handleFinish = async () => {
    if (!settings) return;
    
    const updatedSettings: AppSettings = {
      ...settings,
      onboardingCompleted: true,
    };

    if (apiKey) {
      await window.mate.settings.setApiKey(apiKey);
    }

    await updateAppSettings(updatedSettings);
    void navigate({ to: "/", replace: true });
  };

  if (!settings) return null;

  return (
    <div className="relative flex min-h-[560px] flex-col items-center justify-center py-10">
      <div className="mb-4 flex items-center gap-3">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-3">
            <div 
              className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold transition-colors ${
                idx <= currentStep ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "border-border bg-muted/40 text-muted-foreground"
              }`}
            >
              {idx < currentStep ? <CheckCircle2 className="h-5 w-5" /> : idx + 1}
            </div>
            {idx < steps.length - 1 && (
              <div className={`h-0.5 w-12 transition-colors ${idx < currentStep ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      <div className="mb-8 text-center">
        <p className="text-sm font-semibold text-foreground">{steps[currentStep].title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{steps[currentStep].description}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {capabilityLine.map((item) => (
            <span key={item} className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[10px] font-bold uppercase text-muted-foreground">
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="relative w-full max-w-2xl">
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: "spring", stiffness: 300, damping: 30 },
              opacity: { duration: 0.3 }
            }}
            className="w-full"
          >
            {renderStep(currentStep, { 
              selectedWorkspace,
              policy,
              setPolicy,
              settings,
              setSettings,
              apiKey,
              setApiKey,
              initialApiKey,
              privacyProgress,
              setPrivacyProgress,
              setAppearance,
              setTheme,
              handleNext,
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-10 flex w-full max-w-2xl justify-between items-center">
        <Button variant="ghost" onClick={handleBack} disabled={currentStep === 0} className="hover:bg-accent/10">
          Back
        </Button>
        <Button onClick={handlePrimaryAction} className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 rounded-full px-6">
          {steps[currentStep].cta}
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.25 }}
        transition={{ delay: 1, duration: 1 }}
        className="mt-auto pt-16 pb-2 text-center select-none pointer-events-none"
      >
        <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-muted-foreground max-w-md mx-auto leading-relaxed">
          Local-first security verification for repo changes, secrets, traces, validation, and evidence packs.
        </p>
      </motion.div>
    </div>
  );
}

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 50 : -50,
    opacity: 0
  }),
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1
  },
  exit: (direction: number) => ({
    zIndex: 0,
    x: direction < 0 ? 50 : -50,
    opacity: 0
  })
};

function renderStep(step: number, props: any) {
  switch (step) {
    case 0: return <IntroStep />;
    case 1: return <PreferencesStep {...props} />;
    case 2: return <PrivacyStep {...props} />;
    case 3: return <ApiKeyStep {...props} />;
    case 4: return <WorkspaceStep {...props} />;
    case 5: return <TrustBoundaryStep {...props} />;
    case 6: return <VerificationStep {...props} />;
    default: return null;
  }
}

function IntroStep() {
  return (
    <div className="flex flex-col items-center justify-center text-center space-y-8 py-12">
      <motion.div 
        initial={{ y: 10, opacity: 0, filter: "blur(10px)" }}
        animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="space-y-6"
      >
        <h1 className="text-[5.5rem] leading-none font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-foreground to-foreground/30 pb-2">
          MaTE X
        </h1>
        <motion.p 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-3xl text-foreground font-bold max-w-lg mx-auto tracking-tight"
        >
          Verify AI-generated code before it ships.
        </motion.p>
        <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">
          Local-first security verification for repo changes, secrets, traces, validation, and evidence packs.
        </p>
      </motion.div>
    </div>
  );
}

function PreferencesStep({ settings, setSettings, setAppearance, setTheme }: any) {
  return (
    <Card className="border-border/50 bg-gradient-to-br from-card/80 to-muted/30 backdrop-blur-xl shadow-2xl relative overflow-hidden group rounded-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <CardHeader>
        <div className="flex items-center gap-2 relative z-10">
          <Settings className="h-5 w-5 text-primary" />
          <CardTitle>Set your workspace controls</CardTitle>
        </div>
        <CardDescription className="relative z-10">
          Choose appearance and time format before moving into product verification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 relative z-10">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Appearance</Label>
            <Select
              value={settings.appearance}
              onValueChange={(value) => {
                setSettings({ ...settings, appearance: value as AppearancePreference });
                setAppearance(value as AppearancePreference);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Theme</Label>
            <Select
              value={settings.theme}
              onValueChange={(value) => {
                setSettings({ ...settings, theme: value as ThemePreference });
                setTheme(value as ThemePreference);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="oled">OLED</SelectItem>
                <SelectItem value="midnight">Midnight</SelectItem>
                <SelectItem value="blue">Deep Blue</SelectItem>
                <SelectItem value="deepblue">Ocean Abyss</SelectItem>
                <SelectItem value="deeppurple">Royal Purple</SelectItem>
                <SelectItem value="casimiri">Casimiri</SelectItem>
                <SelectItem value="greenspace">Green Space</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Time Format</Label>
            <Select
              value={settings.timeFormat}
              onValueChange={(value) => setSettings({ ...settings, timeFormat: value as TimeFormat })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="12h">12h</SelectItem>
                <SelectItem value="24h">24h</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PrivacyStep({ privacyProgress, setPrivacyProgress }: any) {
  const [status, setStatus] = useState<any>(null);
  
  useEffect(() => {
    void window.mate.privacy.getModelStatus().then(setStatus);
    return window.mate.privacy.onModelDownloadProgress((progress) => {
      setPrivacyProgress(progress);
    });
  }, [setPrivacyProgress]);

  const handleDownload = async () => {
    await window.mate.privacy.downloadModel();
  };

  const isDownloading = privacyProgress?.state === "downloading" || privacyProgress?.state === "verifying";
  const isReady = status?.inferenceReady || privacyProgress?.state === "ready";
  const loaded = privacyProgress?.loaded ?? 0;
  const total = privacyProgress?.total ?? 0;
  const hasProgressTotal = total > 0;
  const progressPercent = hasProgressTotal ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const progressLabel = hasProgressTotal ? `${progressPercent}%` : "Preparing...";
  const statusLabel = isReady
    ? "Ready"
    : isDownloading
      ? privacyProgress?.state === "verifying" ? "Verifying model" : "Downloading model"
      : "Required for first verification test";

  return (
    <Card className="border-border/50 bg-gradient-to-br from-card/80 to-muted/30 backdrop-blur-xl shadow-2xl relative overflow-hidden group rounded-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <CardHeader>
        <div className="flex items-center gap-2 relative z-10">
          <Shield className="h-5 w-5 text-primary" />
          <CardTitle>Install Privacy Sentinel</CardTitle>
        </div>
        <CardDescription className="relative z-10">
          MaTE X uses a local ONNX model to scan code for secrets and PII before cloud reasoning.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 relative z-10">
        <div className="rounded-xl border border-border/40 bg-muted/40 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">ONNX model status</span>
            {isReady ? (
              <span className="text-xs text-emerald-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Ready
              </span>
            ) : (
              <span className="text-xs text-amber-500">{statusLabel}</span>
            )}
          </div>
          <div className="mb-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <div className="rounded-lg border border-border/40 bg-background/50 px-3 py-2">
              <span className="block text-[10px] uppercase tracking-wide">Runtime</span>
              <span className="font-medium text-foreground">{status?.runtimeAvailable ? "Available" : "Pending"}</span>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/50 px-3 py-2">
              <span className="block text-[10px] uppercase tracking-wide">Inference</span>
              <span className="font-medium text-foreground">{isReady ? "Ready" : "Not ready"}</span>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/50 px-3 py-2">
              <span className="block text-[10px] uppercase tracking-wide">Progress</span>
              <span className="font-medium text-foreground">{progressLabel}</span>
            </div>
          </div>
          {isDownloading ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{privacyProgress.file || "Downloading..."}</span>
                <span>{progressLabel}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: hasProgressTotal ? `${progressPercent}%` : "18%" }}
                  transition={{ repeat: hasProgressTotal ? 0 : Infinity, repeatType: "reverse", duration: 0.9 }}
                />
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full" disabled={isReady} onClick={handleDownload}>
              {isReady ? "Model installed" : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download Privacy Model (340MB)
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ApiKeyStep({ apiKey, setApiKey, initialApiKey }: any) {
  const isConfigured = !!initialApiKey || (apiKey && apiKey.length > 5);

  return (
    <Card className="border-border/50 bg-gradient-to-br from-card/80 to-muted/30 backdrop-blur-xl shadow-2xl relative overflow-hidden group rounded-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <CardHeader>
        <div className="flex items-center gap-2 relative z-10">
          <Key className="h-5 w-5 text-primary" />
          <CardTitle>Connect Rainy API</CardTitle>
        </div>
        <CardDescription className="relative z-10">
          API key is required to test AI reasoning, RepoGraph embeddings, and verification runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 relative z-10">
        <div className="rounded-xl border border-border/40 bg-muted/40 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Connection status</span>
            {isConfigured ? (
              <span className="text-xs text-emerald-500 flex items-center gap-1 font-medium">
                <CheckCircle2 className="h-3 w-3" /> Configured
              </span>
            ) : (
              <span className="text-xs text-amber-500 font-medium">Required for first verification test</span>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiKey" className="text-xs text-muted-foreground">Rainy API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="ra-..."
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className={isConfigured ? "border-emerald-500/30 focus-visible:ring-emerald-500" : ""}
            />
          </div>
        </div>
        <Button
          variant="link"
          className="h-auto p-0 text-xs text-muted-foreground hover:text-primary"
          render={(props) => (
            <a
              {...props}
              href="https://app.rainy-mate.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center"
            >
              Go to app.rainy-mate.com to get your key
              <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          )}
        />
      </CardContent>
    </Card>
  );
}

function WorkspaceStep({ selectedWorkspace }: { selectedWorkspace: string | null }) {
  return (
    <Card className="border-border/50 bg-gradient-to-br from-card/80 to-muted/30 backdrop-blur-xl shadow-2xl relative overflow-hidden group rounded-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <CardHeader>
        <div className="flex items-center gap-2 relative z-10">
          <FolderOpen className="h-5 w-5 text-primary" />
          <CardTitle>Choose a repo to verify</CardTitle>
        </div>
        <CardDescription className="relative z-10">
          MaTE X builds a local repo graph, detects risky surfaces, and prepares validation context without uploading your code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 relative z-10">
        <div className="grid gap-3 sm:grid-cols-3">
          <OnboardingPillar icon={<GitBranch className="h-4 w-4" />} title="Repo graph" body="Map changed files, imports, IPC, and risky surfaces." />
          <OnboardingPillar icon={<Shield className="h-4 w-4" />} title="Privacy Sentinel" body="Screen secrets and sensitive spans locally first." />
          <OnboardingPillar icon={<Database className="h-4 w-4" />} title="Context ready" body="Keep validation evidence tied to workspace state." />
        </div>
        <div className="rounded-xl border border-border/40 bg-muted/40 p-4 text-sm">
          <span className="font-medium">Selected workspace: </span>
          <span className={selectedWorkspace ? "text-foreground" : "text-muted-foreground"}>
            {selectedWorkspace || "Choose repository with Select repository."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function TrustBoundaryStep({ policy, setPolicy }: any) {
  const items = [
    { key: "read", title: "Read repo", body: "Inspect changed files and dependency paths.", icon: Eye },
    { key: "patch", title: "Patch files", body: "Allow proposed fixes after review.", icon: Pencil },
    { key: "commands", title: "Run commands", body: "Use validation commands when needed.", icon: Terminal },
    { key: "approval", title: "Pause on risk", body: "Ask before high-risk actions.", icon: PauseCircle },
  ];

  return (
    <Card className="border-border/50 bg-gradient-to-br from-card/80 to-muted/30 backdrop-blur-xl shadow-2xl relative overflow-hidden group rounded-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <CardHeader>
        <div className="flex items-center gap-2 relative z-10">
          <Lock className="h-5 w-5 text-primary" />
          <CardTitle>Define what MaTE X can touch</CardTitle>
        </div>
        <CardDescription className="relative z-10">
          Choose whether the agent can read, patch, run commands, or pause for approval before high-risk actions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 relative z-10">
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(({ key, title, body, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPolicy((current: typeof policy) => ({ ...current, [key]: !current[key as keyof typeof policy] }))}
              className={`rounded-xl border p-4 text-left transition-colors ${
                policy[key as keyof typeof policy] ? "border-primary/50 bg-primary/10" : "border-border/50 bg-muted/30 hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-xs leading-5 text-muted-foreground">{body}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function VerificationStep() {
  return (
    <Card className="border-border/50 bg-gradient-to-br from-card/80 to-muted/30 backdrop-blur-xl shadow-2xl relative overflow-hidden group rounded-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <CardHeader>
        <div className="flex items-center gap-2 relative z-10">
          <FileCheck2 className="h-5 w-5 text-primary" />
          <CardTitle>Run your first evidence pack</CardTitle>
        </div>
        <CardDescription className="relative z-10">
          Detect secrets, trace risky flows, run validation, and get a go/no-go decision for your current repo changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 relative z-10">
        <div className="grid gap-3 sm:grid-cols-2">
          <OnboardingPillar icon={<Shield className="h-4 w-4" />} title="Secret detection" body="Privacy Sentinel checks exposed credentials and PII." />
          <OnboardingPillar icon={<Route className="h-4 w-4" />} title="Path trace" body="Trace risky input, IPC, shell, network, and storage flows." />
          <OnboardingPillar icon={<Activity className="h-4 w-4" />} title="Validation" body="Run selected checks and capture pass/fail evidence." />
          <OnboardingPillar icon={<PlayCircle className="h-4 w-4" />} title="Go/no-go" body="Produce decision plus replayable evidence pack." />
        </div>
      </CardContent>
    </Card>
  );
}

function OnboardingPillar({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/60 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

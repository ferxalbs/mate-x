import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronRight, 
  Shield, 
  Key, 
  Settings, 
  CheckCircle2, 
  Download, 
  ExternalLink
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { getAppSettings, updateAppSettings } from "../../services/settings-client";
import type { AppSettings, ThemePreference, TimeFormat } from "../../contracts/settings";
import type { PrivacyModelDownloadProgress } from "../../contracts/privacy";

const steps = [
  { id: "intro", title: "Welcome to MaTE X", description: "Your private AI security agent." },
  { id: "privacy", title: "Privacy Sentinel", description: "Local-first security for your code." },
  { id: "api-key", title: "API Configuration", description: "Connect to the Rainy cloud." },
  { id: "config", title: "Essential Setup", description: "Personalize your experience." },
];

export function OnboardingFlow() {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [privacyProgress, setPrivacyProgress] = useState<PrivacyModelDownloadProgress | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void getAppSettings().then(setSettings);
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

  const handleFinish = async () => {
    if (!settings) return;
    
    const updatedSettings: AppSettings = {
      ...settings,
      onboardingCompleted: true,
      supermemoryApiKey: apiKey || settings.supermemoryApiKey, // Though usually user sets Rainy key via separate IPC
    };

    // Note: The Rainy API key is set via settings:set-api-key IPC, not in AppSettings usually.
    // However, the instructions mentioned app.rainy-mate.com.
    // I'll use window.mate.settings.setApiKey if available.
    if (apiKey) {
      await window.mate.settings.setApiKey(apiKey);
    }

    await updateAppSettings(updatedSettings);
    void navigate({ to: "/", replace: true });
  };

  if (!settings) return null;

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[500px] py-12">
      <div className="mb-8 flex items-center gap-4">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex items-center">
            <div 
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                idx <= currentStep ? "border-primary bg-primary text-primary-foreground" : "border-muted text-muted-foreground"
              }`}
            >
              {idx < currentStep ? <CheckCircle2 className="h-5 w-5" /> : idx + 1}
            </div>
            {idx < steps.length - 1 && (
              <div className={`h-0.5 w-8 transition-colors ${idx < currentStep ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      <div className="relative w-full max-w-lg overflow-hidden">
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
              opacity: { duration: 0.2 }
            }}
            className="w-full"
          >
            {renderStep(currentStep, { 
              settings, 
              setSettings, 
              apiKey, 
              setApiKey, 
              privacyProgress, 
              setPrivacyProgress,
              handleNext 
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-8 flex w-full max-w-lg justify-between">
        <Button variant="ghost" onClick={handleBack} disabled={currentStep === 0}>
          Back
        </Button>
        <Button onClick={handleNext}>
          {currentStep === steps.length - 1 ? "Finish" : "Continue"}
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
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
    case 1: return <PrivacyStep {...props} />;
    case 2: return <ApiKeyStep {...props} />;
    case 3: return <ConfigStep {...props} />;
    default: return null;
  }
}

function IntroStep() {
  return (
    <Card className="border-none bg-transparent shadow-none text-center">
      <CardHeader>
        <motion.div 
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10"
        >
          <Shield className="h-10 w-10 text-primary" />
        </motion.div>
        <CardTitle className="text-3xl font-bold tracking-tight">MaTE X</CardTitle>
        <CardDescription className="text-lg">
          Welcome to your local-first AI security partner.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          MaTE X helps you find and fix security vulnerabilities in your codebase while keeping your sensitive data private.
        </p>
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

  const isDownloading = privacyProgress?.state === 'downloading' || privacyProgress?.state === 'verifying';
  const isReady = status?.inferenceReady || privacyProgress?.state === 'ready';

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <CardTitle>Privacy Sentinel</CardTitle>
        </div>
        <CardDescription>
          MaTE X uses a local ONNX model to scan your code for secrets and PII before anything leaves your machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Model Status</span>
            {isReady ? (
              <span className="text-xs text-emerald-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Ready
              </span>
            ) : (
              <span className="text-xs text-amber-500">Not Installed</span>
            )}
          </div>
          
          {isDownloading ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{privacyProgress.file || "Downloading..."}</span>
                <span>{Math.round((privacyProgress.loaded / privacyProgress.total) * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <motion.div 
                  className="h-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${(privacyProgress.loaded / privacyProgress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <Button 
              variant="outline" 
              className="w-full" 
              disabled={isReady} 
              onClick={handleDownload}
            >
              {isReady ? "Model Installed" : (
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

function ApiKeyStep({ apiKey, setApiKey }: any) {
  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          <CardTitle>Rainy Dashboard</CardTitle>
        </div>
        <CardDescription>
          Get your API key to enable powerful AI reasoning and RepoGraph indexing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="apiKey">Rainy API Key</Label>
          <Input 
            id="apiKey" 
            type="password" 
            placeholder="sk-..." 
            value={apiKey} 
            onChange={(e) => setApiKey(e.target.value)} 
          />
        </div>
        <Button 
          variant="link" 
          className="h-auto p-0 text-xs text-primary" 
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

function ConfigStep({ settings, setSettings }: any) {
  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          <CardTitle>Final Touches</CardTitle>
        </div>
        <CardDescription>
          Configure your preferred interface settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Theme</Label>
            <Select 
              value={settings.theme} 
              onValueChange={(v) => setSettings({ ...settings, theme: v as ThemePreference })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="oled">OLED</SelectItem>
                <SelectItem value="midnight">Midnight</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Time Format</Label>
            <Select 
              value={settings.timeFormat} 
              onValueChange={(v) => setSettings({ ...settings, timeFormat: v as TimeFormat })}
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

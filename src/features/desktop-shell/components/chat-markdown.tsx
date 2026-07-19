import { memo, useEffect, useState, useMemo, type ComponentType, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { HugeiconsIcon as HugeIcon } from "@hugeicons/react";
import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "../../../lib/utils";

type SyntaxHighlighterComponent = ComponentType<{
  language?: string;
  style?: { [key: string]: React.CSSProperties };
  PreTag?: string;
  customStyle?: React.CSSProperties;
  codeTagProps?: { style?: React.CSSProperties; className?: string };
  wrapLines?: boolean;
  lineProps?: (lineNumber: number) => React.HTMLProps<HTMLElement> | { className?: string };
  className?: string;
  useInlineStyles?: boolean;
  children: string;
}>;

let syntaxHighlighterPromise: Promise<SyntaxHighlighterComponent> | null = null;

function loadSyntaxHighlighter() {
  syntaxHighlighterPromise ??= import("react-syntax-highlighter").then(
    (mod) => mod.Prism as unknown as SyntaxHighlighterComponent,
  );
  return syntaxHighlighterPromise;
}

interface ChatMarkdownProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
}

export function RawSyntaxHighlighter({ content, language, className }: { content: string; language: string; className?: string }) {
  const [Highlighter, setHighlighter] = useState<SyntaxHighlighterComponent | null>(null);

  const lines = useMemo(() => content.split('\n'), [content]);

  useEffect(() => {
    let cancelled = false;
    void loadSyntaxHighlighter().then((component) => {
      if (!cancelled) setHighlighter(() => component);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Highlighter) {
    return (
      <pre className={cn("m-0 overflow-x-auto text-[12.5px] leading-relaxed text-foreground font-mono", className)}>
        <code style={{ fontFamily: "inherit" }}>
          {content}
        </code>
      </pre>
    );
  }

  return (
    <Highlighter
      language={language}
      PreTag="pre"
      useInlineStyles={false}
      wrapLines={true}
      lineProps={(lineNumber: number) => {
        const lineStr = lines[lineNumber - 1] || '';
        let classes = "block w-full min-w-full pr-6 py-0.5";
        if (lineStr.startsWith('+') && !lineStr.startsWith('+++')) {
          classes += " bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-l-4 border-emerald-500 pl-[20px]";
        } else if (lineStr.startsWith('-') && !lineStr.startsWith('---')) {
          classes += " bg-red-500/10 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-l-4 border-red-500 pl-[20px]";
        } else {
          classes += " pl-6";
        }
        return { className: classes };
      }}
      customStyle={{
        margin: 0,
        padding: "1rem 0",
        background: "transparent",
        fontSize: "12.5px",
        lineHeight: "1.6",
      }}
      codeTagProps={{
        style: { fontFamily: "inherit" }
      }}
      className={className}
    >
      {content}
    </Highlighter>
  );
}

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    return (
      <a href={href} rel="noreferrer" target="_blank" {...props} className="text-blue-500 hover:underline">
        {children}
      </a>
    );
  },
  code({ className, children, ...props }) {
    const content = String(children ?? "");
    const isInline = !className && !content.includes("\n");

    if (isInline) {
      return (
        <code className="rounded-[0.375rem] border border-border bg-muted px-[0.35rem] py-[0.1rem] text-[0.75rem] text-foreground" {...props}>
          {content}
        </code>
      );
    }

    return (
      <CodeBlock className={className}>{content.replace(/\n$/, "")}</CodeBlock>
    );
  },
};

function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [Highlighter, setHighlighter] = useState<SyntaxHighlighterComponent | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const content = String(children ?? "");
  const language = className?.replace(/^language-/, "") ?? "";
  const lines = useMemo(() => content.split('\n'), [content]);

  useEffect(() => {
    let cancelled = false;
    void loadSyntaxHighlighter().then((component) => {
      if (!cancelled) setHighlighter(() => component);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCopy() {
    try {
      await window.mate.ui.copyToClipboard(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy code to clipboard:", error);
      setCopied(false);
    }
  }

  return (
    <div 
      className="group relative my-4 overflow-hidden rounded-2xl border border-border/70 bg-[var(--control)] shadow-none transition-shadow hover:shadow-sm"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        {language && (
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/50 uppercase transition-opacity duration-300">
            {language}
          </span>
        )}
        
        <AnimatePresence>
          {(isHovered || copied) && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              type="button"
              className="flex items-center justify-center rounded-lg border border-border/60 bg-[var(--panel)]/80 p-1.5 text-muted-foreground backdrop-blur-md hover:bg-[var(--panel)] hover:text-foreground focus:outline-none"
              onClick={() => void handleCopy()}
              aria-label={copied ? "Copied code" : "Copy code"}
            >
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.div
                    key="copied"
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, rotate: 45 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <HugeIcon icon={Tick01Icon} className="size-3.5 text-emerald-500" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="copy"
                    initial={{ scale: 0, rotate: 45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, rotate: -45 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <HugeIcon icon={Copy01Icon} className="size-3.5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      
      {Highlighter ? (
        <Highlighter
          language={language}
          PreTag="pre"
          useInlineStyles={false}
          wrapLines={true}
          lineProps={(lineNumber: number) => {
            const lineStr = lines[lineNumber - 1] || '';
            let classes = "block w-full min-w-full pr-6 py-0.5";
            if (lineStr.startsWith('+') && !lineStr.startsWith('+++')) {
              classes += " bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-l-4 border-emerald-500 pl-[20px]";
            } else if (lineStr.startsWith('-') && !lineStr.startsWith('---')) {
              classes += " bg-red-500/10 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-l-4 border-red-500 pl-[20px]";
            } else {
              classes += " pl-6";
            }
            return { className: classes };
          }}
          customStyle={{
            margin: 0,
            padding: "1.25rem 0",
            background: "transparent",
            fontSize: "12.5px",
            lineHeight: "1.6",
          }}
          codeTagProps={{
            style: { fontFamily: "inherit" }
          }}
        >
          {content}
        </Highlighter>
      ) : (
        <pre className="m-0 overflow-x-auto p-5 text-[12.5px] leading-relaxed text-foreground font-mono">
          <code style={{ fontFamily: "inherit" }}>
            {content}
          </code>
        </pre>
      )}
    </div>
  );
}

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  isStreaming = false,
  className,
}: ChatMarkdownProps) {
  return (
    <div
      className={cn(
        "chat-markdown",
        isStreaming ? "chat-markdown-streaming" : "",
        className,
      )}
    >
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

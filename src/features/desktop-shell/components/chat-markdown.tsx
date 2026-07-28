import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useState, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { motion, AnimatePresence } from "framer-motion";

import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-diff";

import { cn } from "../../../lib/utils";
import { ScrollArea } from "../../../components/ui/scroll-area";

interface ChatMarkdownProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
}

interface PrismToken {
  type?: string;
  content: string;
}

function splitTokensIntoLines(tokens: Array<string | Prism.Token>): PrismToken[][] {
  const lines: PrismToken[][] = [[]];

  function processToken(token: string | Prism.Token, type?: string) {
    if (typeof token === "string") {
      const parts = token.split("\n");
      parts.forEach((part, index) => {
        if (index > 0) {
          lines.push([]);
        }
        if (part) {
          lines[lines.length - 1].push({ type, content: part });
        }
      });
    } else {
      const tokenType = token.type;
      if (typeof token.content === "string") {
        const parts = token.content.split("\n");
        parts.forEach((part, index) => {
          if (index > 0) {
            lines.push([]);
          }
          if (part) {
            lines[lines.length - 1].push({ type: tokenType, content: part });
          }
        });
      } else if (Array.isArray(token.content)) {
        token.content.forEach((subToken) => {
          processToken(subToken, tokenType);
        });
      }
    }
  }

  tokens.forEach((token) => processToken(token));
  return lines;
}

function getGrammar(language: string) {
  const lang = language.toLowerCase();
  if (lang === "typescript" || lang === "ts") return Prism.languages.typescript;
  if (lang === "tsx") return Prism.languages.tsx;
  if (lang === "jsx") return Prism.languages.jsx;
  if (lang === "javascript" || lang === "js") return Prism.languages.javascript;
  if (lang === "diff") return Prism.languages.diff;
  if (lang === "bash" || lang === "sh" || lang === "shell") return Prism.languages.bash;
  if (lang === "json") return Prism.languages.json;
  return Prism.languages.clike || Prism.languages.markup;
}

export function CustomSyntaxHighlighter({
  content,
  language,
  className,
  paddingY = "py-4",
}: {
  content: string;
  language: string;
  className?: string;
  paddingY?: string;
}) {
  const grammar = getGrammar(language);
  
  const tokenLines = useMemo(() => {
    if (!grammar) return null;
    try {
      const tokens = Prism.tokenize(content, grammar);
      return splitTokensIntoLines(tokens);
    } catch (e) {
      console.error("Prism tokenization failed:", e);
      return null;
    }
  }, [content, grammar]);

  if (!grammar || !tokenLines) {
    return (
      <ScrollArea
        scrollbarOrientation="horizontal"
        className={cn("w-full text-[12.5px] leading-relaxed text-foreground font-mono", className)}
      >
        <pre className="m-0 overflow-visible py-4">
          <code className="block px-6">{content}</code>
        </pre>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea
      scrollbarOrientation="horizontal"
      className={cn("w-full text-[12.5px] leading-relaxed text-foreground font-mono", className)}
    >
      <pre className={cn("m-0 overflow-visible", paddingY)}>
        <code className="block min-w-full w-fit">
          {tokenLines.map((lineTokens, lineIdx) => {
            const lineStr = lineTokens.map(t => t.content).join('');
            
            let lineClass = "block w-full min-w-full pr-6 py-0.5";
            
            const isAdded = lineStr.startsWith('+') && !lineStr.startsWith('+++');
            const isRemoved = lineStr.startsWith('-') && !lineStr.startsWith('---');
            
            if (isAdded) {
              lineClass += " bg-emerald-500/5 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-l-[2px] border-emerald-500/50 pl-[22px]";
            } else if (isRemoved) {
              lineClass += " bg-red-500/5 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-l-[2px] border-red-500/50 pl-[22px]";
            } else {
              lineClass += " pl-6 opacity-60 hover:opacity-100 transition-opacity duration-200";
            }

            return (
              <div key={lineIdx} className={lineClass}>
                {lineTokens.length === 0 ? (
                  <br />
                ) : (
                  lineTokens.map((token, tokenIdx) => {
                    let tokenClass = token.type ? cn("token", token.type) : undefined;
                    
                    if (language.toLowerCase() === "diff") {
                      if (token.type === "inserted") {
                        tokenClass = "token inserted !text-emerald-700 dark:!text-emerald-400";
                      } else if (token.type === "deleted") {
                        tokenClass = "token deleted !text-red-700 dark:!text-red-400";
                      }
                    }

                    return (
                      <span key={tokenIdx} className={tokenClass}>
                        {token.content}
                      </span>
                    );
                  })
                )}
              </div>
            );
          })}
        </code>
      </pre>
    </ScrollArea>
  );
}

export function RawSyntaxHighlighter({ content, language, className }: { content: string; language: string; className?: string }) {
  return (
    <CustomSyntaxHighlighter
      content={content}
      language={language}
      className={className}
      paddingY="py-1"
    />
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
  const content = String(children ?? "");
  const language = className?.replace(/^language-/, "") ?? "";

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
    <div className="group relative my-3 overflow-hidden rounded-2xl border border-border/40 bg-[var(--control)]/30 transition-colors duration-200 hover:border-border/60 hover:bg-[var(--control)]/50">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {language && (
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/50 uppercase">
            {language}
          </span>
        )}
        
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-all hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground active:scale-95 focus:outline-none"
          onClick={() => void handleCopy()}
          aria-label={copied ? "Copied code" : "Copy code"}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={copied ? "check" : "copy"}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.1 }}
            >
              <HugeiconsIcon 
                icon={copied ? Tick01Icon : Copy01Icon} 
                className={cn("size-3.5", copied && "text-emerald-500")} 
              />
            </motion.div>
          </AnimatePresence>
        </button>
      </div>
      
      <CustomSyntaxHighlighter
        content={content}
        language={language}
        paddingY="py-4"
      />
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

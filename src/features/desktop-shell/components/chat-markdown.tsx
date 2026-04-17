import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { CheckIcon, CopyIcon } from "lucide-react";

import { cn } from "../../../lib/utils";

interface ChatMarkdownProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
}

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        rel="noreferrer"
        target="_blank"
        {...props}
      >
        {children}
      </a>
    );
  },
  code({ className, children, ...props }) {
    const content = String(children ?? "");
    const isInline = !className && !content.includes("\n");

    if (isInline) {
      return (
        <code className={className} {...props}>
          {content}
        </code>
      );
    }

    return (
      <CodeBlock className={className}>
        {content.replace(/\n$/, "")}
      </CodeBlock>
    );
  },
};

function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const content = String(children ?? "");
  const language = className?.replace(/^language-/, "") ?? "";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="chat-markdown-codeblock">
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={() => void handleCopy()}
        aria-label={copied ? "Copied code" : "Copy code"}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
      {language ? (
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/55">
          {language}
        </div>
      ) : null}
      <pre>
        <code className={className}>{content}</code>
      </pre>
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
      className={cn("chat-markdown", isStreaming ? "chat-markdown-streaming" : "", className)}
    >
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

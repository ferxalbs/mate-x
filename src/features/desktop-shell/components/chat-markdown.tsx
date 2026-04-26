import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
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

const customPrismTheme: { [key: string]: React.CSSProperties } = {
  "code[class*=\"language-\"]": {
    color: "var(--foreground)",
    fontFamily: "inherit",
  },
  "pre[class*=\"language-\"]": {
    background: "transparent",
    padding: 0,
    margin: 0,
  },
  "keyword": { color: "var(--code-keyword)" },
  "string": { color: "var(--code-string)" },
  "function": { color: "var(--code-function)" },
  "comment": { color: "var(--code-comment)" },
  "variable": { color: "var(--code-variable)" },
  "operator": { color: "var(--code-operator)" },
  "constant": { color: "var(--code-constant)" },
  "tag": { color: "var(--code-tag)" },
  "boolean": { color: "var(--code-constant)" },
  "number": { color: "var(--code-constant)" },
  "attr-name": { color: "var(--code-variable)" },
  "attr-value": { color: "var(--code-string)" },
  "class-name": { color: "var(--code-class)" },
  "parameter": { color: "var(--code-variable)" },
  "property": { color: "var(--code-variable)" },
  "selector": { color: "var(--code-keyword)" },
  "builtin": { color: "var(--code-class)" },
};

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
    <div className="chat-markdown-codeblock group">
      {language ? (
        <div className="chat-markdown-codeblock-label">
          {language}
        </div>
      ) : null}
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={() => void handleCopy()}
        aria-label={copied ? "Copied code" : "Copy code"}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
      <SyntaxHighlighter
        language={language}
        style={customPrismTheme}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: 0,
          background: "transparent",
        }}
        codeTagProps={{
          style: {
            display: "block",
            paddingTop: language ? "2.2rem" : "0.85rem",
          }
        }}
      >
        {content}
      </SyntaxHighlighter>
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

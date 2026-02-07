"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a className="text-sky-600 underline" {...props}>
            {children}
          </a>
        ),
        ul: ({ children, ...props }) => (
          <ul className="list-disc list-inside space-y-1" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="list-decimal list-inside space-y-1" {...props}>
            {children}
          </ol>
        ),
        code: ({ children, ...props }) => (
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs" {...props}>
            {children}
          </code>
        )
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

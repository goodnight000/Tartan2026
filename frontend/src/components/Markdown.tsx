"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, node, ...props }) => (
          <a className="text-[color:var(--cp-info)] underline underline-offset-2" {...props}>
            {children}
          </a>
        ),
        p: ({ children, node, ...props }) => (
          <p className="leading-6 text-[color:var(--cp-text)]" {...props}>
            {children}
          </p>
        ),
        ul: ({ children, node, ...props }) => (
          <ul className="list-disc space-y-1 pl-4" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, node, ...props }) => (
          <ol className="list-decimal space-y-1 pl-4" {...props}>
            {children}
          </ol>
        ),
        h1: ({ children, node, ...props }) => (
          <h1 className="mt-3 text-xl font-bold text-[color:var(--cp-text)]" {...props}>
            {children}
          </h1>
        ),
        h2: ({ children, node, ...props }) => (
          <h2 className="mt-2 text-lg font-semibold text-[color:var(--cp-text)]" {...props}>
            {children}
          </h2>
        ),
        h3: ({ children, node, ...props }) => (
          <h3 className="mt-2 text-base font-semibold text-[color:var(--cp-text)]" {...props}>
            {children}
          </h3>
        ),
        blockquote: ({ children, node, ...props }) => (
          <blockquote
            className="border-l-[3px] border-[color:var(--cp-accent)] bg-[color:color-mix(in_srgb,var(--cp-accent)_6%,white_94%)] pl-4 py-2 pr-3 rounded-r-xl text-sm italic text-[color:var(--cp-muted)]"
            {...props}
          >
            {children}
          </blockquote>
        ),
        table: ({ children, node, ...props }) => (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" {...props}>
              {children}
            </table>
          </div>
        ),
        thead: ({ children, node, ...props }) => (
          <thead className="border-b border-[color:var(--cp-line)] text-left" {...props}>
            {children}
          </thead>
        ),
        th: ({ children, node, ...props }) => (
          <th
            className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--cp-muted)]"
            {...props}
          >
            {children}
          </th>
        ),
        td: ({ children, node, ...props }) => (
          <td className="border-b border-[color:var(--cp-line)]/30 px-3 py-2 text-[color:var(--cp-text)]" {...props}>
            {children}
          </td>
        ),
        code: ({ children, node, ...props }) => (
          <code
            className="rounded-md bg-[color:var(--cp-surface-soft)] px-1.5 py-0.5 text-xs text-[color:var(--cp-primary)]"
            {...props}
          >
            {children}
          </code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

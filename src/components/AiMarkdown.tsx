import { Check, Copy } from 'lucide-react';
import { ComponentPropsWithoutRef, ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

type CodeProps = ComponentPropsWithoutRef<'code'> & {
  children?: ReactNode;
  className?: string;
  inline?: boolean;
};

function MarkdownCode({ children, className, inline, ...props }: CodeProps) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? '');
  const isInline = inline ?? (!className && !text.includes('\n'));

  if (isInline) {
    return (
      <code className="on-ai-inline-code" {...props}>
        {children}
      </code>
    );
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="on-ai-code-block">
      <button type="button" className="on-ai-code-copy" onClick={() => void copyCode()} aria-label="Copy code">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre>
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

export function AiMarkdown({ content }: { content: string }) {
  return (
    <div className="on-ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ code: MarkdownCode }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "../lib/cn";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Syntax colors come from the theme-aware `.hljs-*` rules in index.css.
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("markdown-content text-sm text-text", className)}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </Markdown>
    </div>
  );
}

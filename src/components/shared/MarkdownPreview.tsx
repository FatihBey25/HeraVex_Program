function renderInlineMarkdown(value: string) {
  const parts = value.split(/(\*\*.*?\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

export function MarkdownPreview({ content, emptyMessage }: { content: string; emptyMessage: string }) {
  const lines = content.split("\n");
  const hasContent = lines.some((line) => line.trim().length > 0);

  if (!hasContent) return <p className="markdown-empty">{emptyMessage}</p>;

  return (
    <div className="markdown-render">
      {lines.map((line, index) => {
        const trimmed = line.trim();

        if (!trimmed) return <div key={index} className="markdown-spacer" />;

        const checkboxMatch = trimmed.match(/^[-*]\s\[( |x|X)\]\s(.+)$/);
        if (checkboxMatch) {
          const checked = checkboxMatch[1].toLowerCase() === "x";
          return (
            <div key={index} className="markdown-check">
              <span className={`markdown-box ${checked ? "markdown-box-checked" : ""}`}>
                {checked ? "✓" : ""}
              </span>
              <span>{renderInlineMarkdown(checkboxMatch[2])}</span>
            </div>
          );
        }

        const bulletMatch = trimmed.match(/^[-*]\s(.+)$/);
        if (bulletMatch) {
          return (
            <div key={index} className="markdown-bullet">
              <span>•</span>
              <span>{renderInlineMarkdown(bulletMatch[1])}</span>
            </div>
          );
        }

        return (
          <p key={index} className="markdown-paragraph">
            {renderInlineMarkdown(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

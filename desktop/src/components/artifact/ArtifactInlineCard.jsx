import { Play } from 'lucide-react';

const LABEL = {
  html: 'HTML preview',
  svg: 'SVG illustration',
  mermaid: 'Mermaid diagram',
  reactjs: 'React component',
};

export default function ArtifactInlineCard({ language, code, isPartial, onOpen }) {
  const label = LABEL[language] || `${language} preview`;
  return (
    <div className="my-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Play className="h-3 w-3" />
        <span className="font-medium text-foreground">{label}</span>
        {isPartial && <span className="text-[10px] animate-pulse">streaming…</span>}
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={isPartial}
        className="rounded bg-primary px-2 py-1 text-white text-[11px] font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        Open Preview
      </button>
    </div>
  );
}

import { useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import ArtifactViewer from './ArtifactViewer.jsx';

export default function ArtifactViewerModal({ open, onOpenChange, code, language }) {
  const handleError = useCallback((msg) => {
    // eslint-disable-next-line no-console
    console.warn('[artifact]', language, msg);
  }, [language]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className="fixed inset-4 z-50 flex flex-col rounded-lg border border-border bg-card shadow-xl"
          aria-describedby={undefined}
        >
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
            <Dialog.Title className="text-sm font-medium">
              {language} preview
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close preview"
                className="rounded p-1 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 min-h-0">
            <ArtifactViewer code={code} language={language} onError={handleError} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

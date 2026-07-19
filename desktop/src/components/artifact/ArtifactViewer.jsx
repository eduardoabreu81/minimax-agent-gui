import { useEffect, useRef } from 'react';
import { buildSrcDoc } from './artifactTemplates.js';

// Renders a sandboxed iframe for one artifact. Listens for the iframe's
// postMessage error bridge (window.onerror / unhandledrejection) and
// forwards it to the parent via onError. We intentionally do NOT
// re-mount the iframe on every keystroke (no key={code}); during
// streaming the iframe repaints with the latest srcdoc, which is cheap
// for small artifacts and avoids tearing the iframe down.
export default function ArtifactViewer({ code, language, onError }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    function onMessage(ev) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (ev.data?.type === 'artifact:error') {
        onError?.(String(ev.data.message || 'Unknown runtime error'));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onError]);

  return (
    <iframe
      ref={iframeRef}
      title="artifact-preview"
      sandbox="allow-scripts"
      srcDoc={buildSrcDoc(language, code)}
      className="w-full h-full border-0 bg-white"
    />
  );
}

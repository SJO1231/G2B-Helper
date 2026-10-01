import { useEffect, useRef } from 'react';

export function useUnsavedChanges(dirty: boolean): void {
  const current = useRef(dirty); current.current = dirty;
  useEffect(() => {
    const closing = (event: Event) => { if (current.current) event.preventDefault(); };
    const leaving = (event: BeforeUnloadEvent) => { if (current.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('pce:close-check', closing); window.addEventListener('beforeunload', leaving);
    return () => { window.removeEventListener('pce:close-check', closing); window.removeEventListener('beforeunload', leaving); };
  }, []);
}

// Tiny FPS + JS heap overlay.
//
// Mounted from App.tsx and self-gates on
// `experimental.performanceMonitor`. Implements a 1s requestAnimationFrame
// counter for FPS and reads `performance.memory.usedJSHeapSize` when
// the browser exposes it (Chromium does, Firefox doesn't — non-fatal,
// the heap line just stays blank).

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";

interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
}

export function PerformanceMonitor() {
  const enabled = useAppStore((s) => s.experimental.performanceMonitor);
  const [fps, setFps] = useState(0);
  const [heap, setHeap] = useState<number | null>(null);
  const framesRef = useRef(0);
  const lastTickRef = useRef(performance.now());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const loop = () => {
      framesRef.current++;
      const now = performance.now();
      if (now - lastTickRef.current >= 1000) {
        setFps(framesRef.current);
        framesRef.current = 0;
        lastTickRef.current = now;
        // `performance.memory` is non-standard but Chromium-shipped.
        const mem = (performance as unknown as { memory?: PerfMemory }).memory;
        if (mem) setHeap(Math.round(mem.usedJSHeapSize / (1024 * 1024)));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="perf-monitor" aria-hidden="true">
      <span className="perf-monitor-row">FPS <strong>{fps}</strong></span>
      {heap != null && <span className="perf-monitor-row">RAM <strong>{heap}MB</strong></span>}
    </div>
  );
}

import { useEffect, useState } from "react";

export function StatCard({ label, value }: { label: string; value: string }) {
  const target = parseInt(value, 10);
  const [display, setDisplay] = useState(isNaN(target) ? value : 0);

  useEffect(() => {
    if (isNaN(target)) { setDisplay(value); return; }
    setDisplay(0);
    const duration = 600;
    const start = performance.now();
    const raf = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{isNaN(target) ? value : String(display)}</strong>
    </div>
  );
}

// Full-page host for plugin-contributed pages (v0.9.9).
//
// The workspace router hands us the active `plugin:<id>/<page>` tab key;
// we look the render function up in the plugin registry and hand it a
// bare DOM node — plugins are framework-agnostic vanilla-DOM by
// contract. A plugin failing mid-render can never take the app down:
// the error is contained to this panel.

import { useEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { useAppStore } from "../store";
import { getPluginPageRender } from "../lib/plugins";

export function PluginPageHost({ tabKey }: { tabKey: string }) {
  const language = useAppStore((s) => s.language);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [tick, setTick] = useState(0);
  const [missing, setMissing] = useState(false);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  // Re-mount when the plugin set changes (enable/disable/reinstall).
  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener("heravex:plugins-changed", onChange);
    return () => window.removeEventListener("heravex:plugins-changed", onChange);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.innerHTML = "";
    const render = getPluginPageRender(tabKey);
    if (!render) { setMissing(true); return; }
    setMissing(false);
    let cleanup: (() => void) | void;
    try {
      cleanup = render(el);
    } catch (err) {
      el.innerHTML = "";
      const msg = document.createElement("p");
      msg.className = "plugin-page-error";
      msg.textContent = tr("Plugin page crashed: ", "Eklenti sayfası hata verdi: ") + String(err);
      el.appendChild(msg);
    }
    return () => {
      try { cleanup?.(); } catch { /* plugin teardown */ }
      el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, tick]);

  return (
    <div className="plugin-page">
      {missing && (
        <div className="plugin-page-missing">
          <Puzzle size={40} strokeWidth={1.6} />
          <h3>{tr("Plugin page not available", "Eklenti sayfası kullanılamıyor")}</h3>
          <p>{tr(
            "The plugin may be disabled or uninstalled. Check Settings → Plugins.",
            "Eklenti devre dışı ya da kaldırılmış olabilir. Ayarlar → Eklentiler'e bak.",
          )}</p>
        </div>
      )}
      <div ref={rootRef} className="plugin-page-host" />
    </div>
  );
}

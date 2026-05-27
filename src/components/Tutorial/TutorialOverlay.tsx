import { useEffect, useLayoutEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X, Sparkles, Globe } from "lucide-react";
import { useAppStore, type WorkspaceTab } from "../../store";
import { TUTORIAL_STEPS, TUTORIAL_UI } from "../../lib/tutorialSteps";
import type { AppLanguage } from "../../lib/i18n";

/** Languages exposed in the up-front picker. Display strings stay in the
 *  language itself so each option reads natively, regardless of the
 *  currently-active app language. */
const LANG_OPTIONS: { code: AppLanguage; native: string; english: string }[] = [
  { code: "en", native: "English",  english: "English" },
  { code: "tr", native: "Türkçe",   english: "Turkish" },
  { code: "fr", native: "Français", english: "French" },
  { code: "es", native: "Español",  english: "Spanish" },
];

const LANG_PICKER_COPY: Record<AppLanguage, { title: string; subtitle: string; cta: string }> = {
  en: { title: "Pick your language",  subtitle: "We'll walk you through HeraVex in this language. You can switch any time from the Identity panel.", cta: "Start tour" },
  tr: { title: "Dilini seç",          subtitle: "Sana HeraVex'i bu dilde anlatacağız. İstediğin zaman Kimlik panelinden değiştirebilirsin.",          cta: "Rehberi başlat" },
  fr: { title: "Choisissez la langue", subtitle: "Nous vous guiderons dans HeraVex dans cette langue. Vous pouvez changer à tout moment depuis le panneau Identité.", cta: "Lancer le tour" },
  es: { title: "Elige tu idioma",     subtitle: "Te guiaremos por HeraVex en este idioma. Puedes cambiarlo en cualquier momento desde el panel de Identidad.",       cta: "Iniciar tour" },
};

const COMPLETED_KEY = "heravex_tutorial_completed";
const PADDING = 10; // px around spotlight rect

type Rect = { top: number; left: number; width: number; height: number };

function getRect(selector: string | null): Rect | null {
  if (!selector) return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
  };
}

export function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const { language, setLanguage, setWorkspaceTab } = useAppStore();
  const ui = TUTORIAL_UI[language];

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Language picker shows once at the very start of the tour. After the user
  // confirms (or skips), regular chapter flow takes over.
  const [showLangPicker, setShowLangPicker] = useState(true);

  const step = TUTORIAL_STEPS[index];
  const isLast = index === TUTORIAL_STEPS.length - 1;
  const isFirst = index === 0;

  // Switch workspace tab before measuring — wait one tick so DOM updates.
  useEffect(() => {
    if (step.preferredTab) {
      setWorkspaceTab(step.preferredTab as WorkspaceTab);
    }
  }, [index, step.preferredTab, setWorkspaceTab]);

  // Measure target rect; re-measure on resize and after tab switch settles.
  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      setRect(getRect(step.selector));
    };
    // initial + small delay for tab-switch DOM update
    measure();
    const t1 = window.setTimeout(measure, 80);
    const t2 = window.setTimeout(measure, 240);

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step.selector, index]);

  // ESC to skip, ←/→ to navigate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft" && !isFirst) {
        e.preventDefault();
        setIndex((i) => i - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isFirst, isLast]);

  const advance = () => {
    if (isLast) {
      finish();
    } else {
      setIndex((i) => i + 1);
    }
  };

  const finish = () => {
    markTutorialDismissed();
    onClose();
  };

  // Position the info card: opposite side of the spotlight when possible,
  // centered when no selector. All branches clamp aggressively so the card
  // can never paint outside the viewport on low-resolution displays.
  const cardStyle: React.CSSProperties = (() => {
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(360, window.innerHeight);
    const margin = 16;

    // Card width shrinks on narrow screens. CSS also enforces this with
    // `max-width: calc(100vw - 32px)` but computing here keeps the layout
    // math accurate.
    const cardWidth  = Math.min(460, vw - margin * 2);
    // Estimated card height — used to pick the side with enough room.
    // Real height varies with content; we clamp the *top* edge so that
    // even if the card ends up taller than this estimate, it still starts
    // inside the viewport. CSS max-height + scroll handles the overflow.
    const cardHeight = Math.min(420, vh - margin * 2);

    // No anchor element → dead-center.
    if (!rect) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        maxWidth: `${cardWidth}px`,
        maxHeight: `${vh - margin * 2}px`,
      };
    }

    const clampTop = (raw: number) =>
      Math.max(margin, Math.min(raw, vh - cardHeight - margin));
    const clampLeft = (raw: number) =>
      Math.max(margin, Math.min(raw, vw - cardWidth - margin));

    // Prefer right of target, else left, else below, else above.
    if (rect.left + rect.width + cardWidth + margin < vw) {
      return {
        left: rect.left + rect.width + margin,
        top: clampTop(rect.top),
        maxWidth: `${cardWidth}px`,
        maxHeight: `${vh - margin * 2}px`,
      };
    }
    if (rect.left - cardWidth - margin > 0) {
      return {
        left: rect.left - cardWidth - margin,
        top: clampTop(rect.top),
        maxWidth: `${cardWidth}px`,
        maxHeight: `${vh - margin * 2}px`,
      };
    }
    if (rect.top + rect.height + cardHeight + margin < vh) {
      return {
        left: clampLeft(rect.left),
        top: rect.top + rect.height + margin,
        maxWidth: `${cardWidth}px`,
        maxHeight: `${vh - margin * 2}px`,
      };
    }
    return {
      left: clampLeft(rect.left),
      top: clampTop(rect.top - cardHeight - margin),
      maxWidth: `${cardWidth}px`,
      maxHeight: `${vh - margin * 2}px`,
    };
  })();

  // ── Up-front language picker ────────────────────────────────────────
  // Renders as a centered modal over the dim layer. No spotlight cutout.
  if (showLangPicker) {
    const copy = LANG_PICKER_COPY[language];
    return (
      <div className="tutorial-overlay-root" role="dialog" aria-modal="true" aria-label={copy.title}>
        <div className="tutorial-overlay-dim-flat" />
        <div className="tutorial-card tutorial-lang-card" style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}>
          <div className="tutorial-card-head">
            <span className="tutorial-card-chapter">
              <Globe size={12} strokeWidth={2.2} />
              {(["LANGUAGE", "DİL", "LANGUE", "IDIOMA"] as const)[
                language === "tr" ? 1 : language === "fr" ? 2 : language === "es" ? 3 : 0
              ]}
            </span>
            <button
              type="button"
              className="tutorial-card-close"
              onClick={finish}
              aria-label={ui.skip}
              title={ui.skip}
            >
              <X size={16} />
            </button>
          </div>

          <h3 className="tutorial-card-title">{copy.title}</h3>

          <div className="tutorial-card-body">
            <p style={{ marginBottom: 14 }}>{copy.subtitle}</p>
            <div className="tutorial-lang-grid">
              {LANG_OPTIONS.map((opt) => {
                const active = opt.code === language;
                return (
                  <button
                    key={opt.code}
                    type="button"
                    className={`tutorial-lang-btn ${active ? "is-active" : ""}`}
                    onClick={() => { void setLanguage(opt.code); }}
                  >
                    <strong>{opt.native}</strong>
                    <small>{opt.english}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="tutorial-card-foot">
            <div className="tutorial-card-actions" style={{ width: "100%", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="tutorial-btn tutorial-btn-primary"
                onClick={() => setShowLangPicker(false)}
              >
                {copy.cta}
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="tutorial-overlay-root"
      role="dialog"
      aria-modal="true"
      aria-label={step.title[language]}
    >
      {/* Dim layer with cutout for the spotlight using SVG mask */}
      <svg
        className="tutorial-overlay-dim"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        pointerEvents="auto"
        onClick={(e) => {
          // Ignore clicks inside the spotlight rect so the user can still see
          // the highlighted element clearly; clicks outside dismiss to next.
          if (!rect) return;
          const { clientX, clientY } = e;
          if (
            clientX >= rect.left &&
            clientX <= rect.left + rect.width &&
            clientY >= rect.top &&
            clientY <= rect.top + rect.height
          ) {
            return;
          }
          // Don't auto-advance; only the explicit buttons advance.
        }}
      >
        <defs>
          <mask id="tutorial-cutout">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left}
                y={rect.top}
                width={rect.width}
                height={rect.height}
                rx={12}
                ry={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(8, 12, 24, 0.72)"
          mask="url(#tutorial-cutout)"
        />
        {rect && (
          <rect
            x={rect.left}
            y={rect.top}
            width={rect.width}
            height={rect.height}
            rx={12}
            ry={12}
            fill="none"
            stroke="rgba(120, 160, 255, 0.85)"
            strokeWidth={2}
            style={{ filter: "drop-shadow(0 0 18px rgba(120,160,255,0.55))" }}
          />
        )}
      </svg>

      {/* Info card */}
      <div className="tutorial-card" style={cardStyle}>
        <div className="tutorial-card-head">
          <span className="tutorial-card-chapter">
            <Sparkles size={12} strokeWidth={2.2} />
            {step.chapter[language]}
          </span>
          <button
            type="button"
            className="tutorial-card-close"
            onClick={finish}
            aria-label={ui.skip}
            title={ui.skip}
          >
            <X size={16} />
          </button>
        </div>

        <h3 className="tutorial-card-title">{step.title[language]}</h3>

        <div className="tutorial-card-body">
          {step.body[language].split("\n").map((line, i) =>
            line.trim() === "" ? (
              <div key={i} style={{ height: 6 }} />
            ) : (
              <p key={i} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
            )
          )}
        </div>

        <div className="tutorial-card-foot">
          <div className="tutorial-progress">
            <div
              className="tutorial-progress-fill"
              style={{ width: `${((index + 1) / TUTORIAL_STEPS.length) * 100}%` }}
            />
            <span className="tutorial-progress-label">
              {ui.progressOf(index + 1, TUTORIAL_STEPS.length)}
            </span>
          </div>

          <div className="tutorial-card-actions">
            <button
              type="button"
              className="tutorial-btn tutorial-btn-ghost"
              onClick={finish}
            >
              {ui.skip}
            </button>
            <button
              type="button"
              className="tutorial-btn tutorial-btn-secondary"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={isFirst}
            >
              <ChevronLeft size={14} />
              {ui.back}
            </button>
            <button
              type="button"
              className="tutorial-btn tutorial-btn-primary"
              onClick={advance}
            >
              {isLast ? ui.finish : ui.next}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mini inline-markdown: only **bold** and `code` are rendered. */
function renderInline(s: string): string {
  // Escape first to avoid HTML injection from tutorial copy.
  const escape = (raw: string) =>
    raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return escape(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Tutorial visibility is now data-driven: we only auto-open on app start when
 * the workspace has no games (i.e. genuinely fresh install or post-reset).
 * The legacy localStorage "completed" flag is no longer the trigger — but we
 * keep the session-scoped dismissal in memory via `dismissedThisSession` so a
 * user who skips it isn't badgered until they reload the app.
 */
let dismissedThisSession = false;

export function shouldShowTutorial(hasAnyData: boolean): boolean {
  if (hasAnyData) return false;
  return !dismissedThisSession;
}

export function markTutorialDismissed(): void {
  dismissedThisSession = true;
}

export function resetTutorial(): void {
  // Used by "Restart tutorial" button in Profile. Clears both the legacy
  // completed flag (in case it was set in an older build) and the session
  // dismissal so the overlay opens immediately on next request.
  dismissedThisSession = false;
  try { localStorage.removeItem(COMPLETED_KEY); } catch {}
}

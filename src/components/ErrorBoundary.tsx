import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

// Localized strings for the recovery screen. The boundary can't pull
// from Zustand because componentDidCatch runs before the React tree
// re-renders; reading the saved language preference from localStorage
// (the same key the store hydrates from on boot) is the safest way to
// match the user's locale without coupling to the rest of the app.
type Lang = "en" | "tr" | "fr" | "es";
const COPY: Record<Lang, { title: string; retry: string }> = {
  en: { title: "Something went wrong", retry: "Try again" },
  tr: { title: "Bir şeyler ters gitti", retry: "Tekrar dene" },
  fr: { title: "Une erreur s'est produite", retry: "Réessayer" },
  es: { title: "Algo salió mal", retry: "Reintentar" },
};
function readLang(): Lang {
  try {
    const raw = localStorage.getItem("studiohub_lang") ?? localStorage.getItem("heravex_lang");
    if (raw === "tr" || raw === "fr" || raw === "es" || raw === "en") return raw;
  } catch { /* storage unavailable in some embedded contexts */ }
  return "en";
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const copy = COPY[readLang()];
      return (
        this.props.fallback ?? (
          <div className="error-boundary-screen">
            <h2>{copy.title}</h2>
            <pre>{this.state.error.message}</pre>
            <button
              className="primary-button"
              onClick={() => this.setState({ error: null })}
            >
              {copy.retry}
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

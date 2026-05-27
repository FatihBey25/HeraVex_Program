import { useCallback, useState } from "react";
import { Trash, Receipt, PieChart as PieIcon } from "lucide-react";
import { imgSrc } from "../lib/images";
import { useAppStore } from "../store";
import { PieChartWidget, calculateAccumulatedAmount } from "./PieChartWidget";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { EmptyState } from "./shared/EmptyState";
import { isGeneralGame } from "../lib/general-game";
import type { ExpenseItem } from "../types";

const CURRENCY_OPTIONS = ["EUR","TRY","JPY","GBP","CAD","AUD","CHF","SEK","NOK","DKK","PLN","CZK"];
const GENERAL_CATEGORIES = ["Office","Hardware","License","Art","Sound","Marketing","Tax","Other"];
const PROJECT_CATEGORIES = ["Art","Code","Sound","Marketing","License","Tax","Other"];

function useExpenseForm() {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Art");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [isRecurring, setIsRecurring] = useState(false);

  const reset = useCallback(() => { setTitle(""); setAmount(""); setNotes(""); }, []);
  const build = useCallback((): ExpenseItem | null => {
    if (!title.trim() || !amount.trim()) return null;
    const n = Number(amount);
    if (Number.isNaN(n) || n <= 0) return null;
    return { id: crypto.randomUUID(), title: title.trim(), amount: n, category, spentAt: date, notes: notes.trim(), currency, isRecurring };
  }, [title, amount, category, date, notes, currency, isRecurring]);

  return { title, setTitle, amount, setAmount, category, setCategory, date, setDate, notes, setNotes, currency, setCurrency, isRecurring, setIsRecurring, reset, build };
}

// ── Moved outside Wallet to prevent remount on every parent re-render ──────────

interface FormProps {
  form: ReturnType<typeof useExpenseForm>;
  categories: string[];
  gameId: string | null;
  activeCurrencies: string[];
  addLabel: string;
  addProjectLabel: string;
  titleLabel: string;
  amountLabel: string;
  currencyLabel: string;
  categoryLabel: string;
  dateLabel: string;
  recurringLabel: string;
  onSubmit: (gameId: string | null) => void;
}

function ExpenseFormFields({
  form, categories, gameId, activeCurrencies,
  addLabel, addProjectLabel, titleLabel, amountLabel, currencyLabel, categoryLabel, dateLabel, recurringLabel,
  onSubmit,
}: FormProps) {
  return (
    <div className="expense-form-grid">
      <label className="field-label">
        <span>{titleLabel}</span>
        <input className="input" value={form.title} onChange={(e) => form.setTitle(e.target.value)} />
      </label>
      <div className="expense-row-split">
        <label className="field-label" style={{ flex: 1 }}>
          <span>{amountLabel}</span>
          <input className="input" type="number" step="0.01" value={form.amount} onChange={(e) => form.setAmount(e.target.value)} />
        </label>
        <label className="field-label" style={{ flex: 1 }}>
          <span>{currencyLabel}</span>
          <select className="input" value={form.currency} onChange={(e) => form.setCurrency(e.target.value)}>
            {activeCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="field-label">
        <span>{categoryLabel}</span>
        <select className="input" value={form.category} onChange={(e) => form.setCategory(e.target.value)}>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="field-label">
        <span>{dateLabel}</span>
        <input className="input" type="date" value={form.date} onChange={(e) => form.setDate(e.target.value)} />
      </label>
      <label className="expense-recurring-row">
        <input type="checkbox" checked={form.isRecurring} onChange={(e) => form.setIsRecurring(e.target.checked)} />
        <span>{recurringLabel}</span>
      </label>
      <button
        className="primary-button expense-submit-btn expense-submit-btn-large"
        onClick={() => onSubmit(gameId)}
        disabled={!form.title.trim() || !form.amount.trim()}
      >
        + {gameId ? addProjectLabel : addLabel}
      </button>
    </div>
  );
}

interface HistoryProps {
  expenses: ExpenseItem[];
  gameId: string | null;
  historyLabel: string;
  emptyLabel: string;
  rate: (c: string) => number;
  onDelete: (id: string, gameId: string | null) => void;
}

function ExpenseHistory({ expenses, gameId, historyLabel, emptyLabel, rate, onDelete }: HistoryProps) {
  return (
    <div className="expense-history-section">
      <h4 className="expense-history-title">{historyLabel}</h4>
      {expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={emptyLabel}
          size="compact"
        />
      ) : (
        <div className="expense-history-list">
          {expenses.map((e) => (
            <div key={e.id} className="expense-history-row">
              <div className="expense-history-body">
                <div className="expense-history-top">
                  <strong className="expense-history-name">{e.title}{e.isRecurring && " 🔄"}</strong>
                  <span className="expense-history-amount">{e.amount.toFixed(2)} {e.currency}</span>
                </div>
                <div className="expense-history-meta">
                  <span className="expense-category-chip">{e.category}</span>
                  <span className="expense-history-date">{e.spentAt}</span>
                  {e.isRecurring && (
                    <span className="expense-history-usd">${calculateAccumulatedAmount(e, rate(e.currency ?? "USD")).toFixed(2)}</span>
                  )}
                </div>
              </div>
              <button
                className="icon-button expense-delete-btn"
                onClick={() => onDelete(e.id, gameId)}
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DistributionProps {
  expenses: ExpenseItem[];
  rate: (c: string) => number;
  emptyLabel: string;
  distLabel: string;
}

function ExpenseDistribution({ expenses, rate, emptyLabel, distLabel }: DistributionProps) {
  // Group totals per category so we can fall back to a single-bar layout when
  // the pie would just render one full circle (useless).
  const byCategory = expenses.reduce<Record<string, number>>((acc, e) => {
    const cat = e.category || "Other";
    acc[cat] = (acc[cat] ?? 0) + calculateAccumulatedAmount(e, rate(e.currency ?? "USD"));
    return acc;
  }, {});
  const categoryEntries = Object.entries(byCategory).filter(([, v]) => v > 0);
  const singleCategory = categoryEntries.length === 1 ? categoryEntries[0] : null;

  return (
    <div className="expense-dist-section">
      <h4 className="expense-dist-title">{distLabel}</h4>
      {expenses.length === 0 ? (
        <EmptyState
          icon={PieIcon}
          title={emptyLabel}
          size="compact"
        />
      ) : singleCategory ? (
        <div className="expense-dist-single">
          <div className="expense-dist-single-head">
            <span className="expense-dist-single-cat">{singleCategory[0]}</span>
            <span className="expense-dist-single-amt">
              ${singleCategory[1].toFixed(2)}
            </span>
          </div>
          <div className="expense-dist-single-bar">
            <div className="expense-dist-single-fill" />
          </div>
          <span className="expense-dist-single-pct">100%</span>
        </div>
      ) : (
        <div className="expense-dist-chart">
          <PieChartWidget expenses={expenses} getExchangeRate={rate} />
        </div>
      )}
    </div>
  );
}

// ── Main Wallet component ──────────────────────────────────────────────────────

export function Wallet() {
  const {
    games, globalExpenses, exchangeRates, activeCurrencies,
    setActiveCurrencies, handleAddExpense, handleDeleteExpense, ui, language,
  } = useAppStore();

  const [walletTab, setWalletTab] = useState<"general" | "projects">("general");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currencyAddOpen, setCurrencyAddOpen] = useState(false);
  const [newCurrencyDraft, setNewCurrencyDraft] = useState("EUR");
  const [confirmExpense, setConfirmExpense] = useState<{
    id: string; gameId: string | null; title: string;
  } | null>(null);

  const form = useExpenseForm();

  const rate = useCallback((c: string) => exchangeRates[c] ?? 1, [exchangeRates]);

  const totalAll =
    globalExpenses.reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0) +
    games.reduce((s, g) => s + g.expenses.reduce((es, e) => es + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0), 0);

  const submitExpense = useCallback(async (gameId: string | null) => {
    const expense = form.build();
    if (!expense) return;
    await handleAddExpense(expense, gameId);
    form.reset();
  }, [form, handleAddExpense]);

  const requestDelete = useCallback((id: string, gameId: string | null) => {
    const pool = gameId
      ? games.find((g) => g.id === gameId)?.expenses ?? []
      : globalExpenses;
    const entry = pool.find((e) => e.id === id);
    setConfirmExpense({ id, gameId, title: entry?.title ?? "" });
  }, [games, globalExpenses]);

  const confirmDelete = useCallback(async () => {
    if (!confirmExpense) return;
    await handleDeleteExpense(confirmExpense.id, confirmExpense.gameId);
    setConfirmExpense(null);
  }, [confirmExpense, handleDeleteExpense]);

  const noExpensesLabel = language === "tr" ? "Henüz gider eklenmedi" : "No expenses yet";
  const distEmptyLabel  = language === "tr" ? "Henüz gider kaydedilmedi" : "No data yet";

  return (
    <div className="wallet-layout page-fade">

      {/* Currency panel */}
      <div className="wallet-currency-panel">
        <div className="wallet-currency-head">
          <span className="wallet-currency-title">{ui.wActiveCurrencies}</span>
          <button className="icon-button currency-toggle-btn" onClick={() => setCurrencyAddOpen((o) => !o)}>
            {currencyAddOpen ? ui.wClose : ui.wAddCurrency}
          </button>
        </div>
        <div className="wallet-currency-list">
          {activeCurrencies.map((cur) => (
            <div key={cur} className="wallet-currency-row">
              <span className="currency-code">{cur}</span>
              {cur === "USD" ? (
                <span className="currency-rate currency-rate-base">
                  1 USD <em>({language === "tr" ? "ana" : "base"})</em>
                </span>
              ) : (
                <span className="currency-rate">
                  {/* Internal `rates[c]` is USD-per-CUR. The user-facing
                   *  label reads naturally in the "1 USD = X CUR"
                   *  direction, which is the inverse. */}
                  1 USD = {(() => {
                    const r = exchangeRates[cur];
                    if (!r || r <= 0) return "—";
                    const inv = 1 / r;
                    return inv >= 100 ? inv.toFixed(2) : inv.toFixed(4);
                  })()} {cur}
                </span>
              )}
              {cur !== "USD" && (
                <button className="icon-button currency-remove-btn" onClick={() => setActiveCurrencies(activeCurrencies.filter((c) => c !== cur))}>
                  <Trash size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className={`wallet-accordion ${currencyAddOpen ? "wallet-accordion-open" : ""}`}>
          <div className="currency-add-row">
            <select className="input" value={newCurrencyDraft} onChange={(e) => setNewCurrencyDraft(e.target.value)} style={{ flex: 1, padding: "0.4rem" }}>
              {CURRENCY_OPTIONS.filter((c) => !activeCurrencies.includes(c)).map((c) => {
                const r = exchangeRates[c];
                const display = !r || r <= 0
                  ? "..."
                  : (() => {
                      const inv = 1 / r;
                      return inv >= 100 ? inv.toFixed(2) : inv.toFixed(4);
                    })();
                return (
                  <option key={c} value={c}>{c} — 1 USD = {display} {c}</option>
                );
              })}
            </select>
            <button className="primary-button" style={{ padding: "0.4rem 1rem", whiteSpace: "nowrap" }} onClick={() => {
              if (newCurrencyDraft && !activeCurrencies.includes(newCurrencyDraft)) {
                const next = [...activeCurrencies, newCurrencyDraft];
                setActiveCurrencies(next);
                setNewCurrencyDraft(CURRENCY_OPTIONS.find((c) => !next.includes(c)) ?? "EUR");
              }
            }}>{ui.wAddAction}</button>
          </div>
        </div>
      </div>

      {/* Header */}
      <section className="wallet-top-card" style={{ paddingRight: "360px" }}>
        <div style={{ flex: 1 }}>
          <p className="eyebrow">STUDIO DASHBOARD</p>
          <h1 style={{ margin: 0, fontSize: "2rem" }}>{ui.financialSummary}</h1>
          <h2 style={{ marginTop: "1rem", fontSize: "2.5rem", fontWeight: 800, color: "var(--primary)" }}>
            $ {totalAll.toFixed(2)}
          </h2>
          <span className="eyebrow">{ui.wTotalAllPlain}</span>
        </div>
      </section>

      {/* Tabs */}
      <div className="wallet-tabs">
        <button className={`wallet-tab-btn ${walletTab === "general" ? "wallet-tab-active" : ""}`} onClick={() => setWalletTab("general")}>{ui.wTabGeneral}</button>
        <button className={`wallet-tab-btn ${walletTab === "projects" ? "wallet-tab-active" : ""}`} onClick={() => setWalletTab("projects")}>{ui.wTabProjects}</button>
      </div>

      {/* General tab */}
      {walletTab === "general" && (
        <div className="wallet-tab-panel page-fade">
          <section className="wallet-accordion-card">
            <div className="wallet-accordion-header" onClick={() => setExpandedId(expandedId === "__general__" ? null : "__general__")}>
              <div className="wallet-accordion-info">
                <p className="eyebrow">{ui.wGeneralStudioExp}</p>
                <h3>{ui.wGeneralStudioDesc}</h3>
                <p className="wallet-sub-copy">{ui.wGeneralStudioSub}</p>
              </div>
              <div className="wallet-accordion-total">
                $ {globalExpenses.reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0).toFixed(2)}
              </div>
            </div>
            <div className={`wallet-accordion ${expandedId === "__general__" ? "wallet-accordion-open" : ""}`} style={{ borderTop: expandedId === "__general__" ? "1px solid #ffffff20" : "none" }}>
              <div className="wallet-expand-body">
                <div className="wallet-split-grid">
                  <div>
                    <h4 className="wallet-section-h4">{ui.wAddGeneral}</h4>
                    <ExpenseFormFields
                      form={form}
                      categories={GENERAL_CATEGORIES}
                      gameId={null}
                      activeCurrencies={activeCurrencies}
                      titleLabel={ui.wExpenseTitle as string}
                      amountLabel={ui.wAmount as string}
                      currencyLabel={ui.wCurrency as string}
                      categoryLabel={ui.wCategory as string}
                      dateLabel={ui.wDate as string}
                      recurringLabel={ui.wRecurring as string}
                      addLabel={ui.wAdd as string}
                      addProjectLabel={ui.wAddToProject as string}
                      onSubmit={(gid) => void submitExpense(gid)}
                    />
                  </div>
                  <div>
                    <ExpenseDistribution
                      expenses={globalExpenses}
                      rate={rate}
                      distLabel={ui.wExpenseDist as string}
                      emptyLabel={distEmptyLabel}
                    />
                    <ExpenseHistory
                      expenses={globalExpenses}
                      gameId={null}
                      historyLabel={ui.wHistory as string}
                      emptyLabel={noExpensesLabel}
                      rate={rate}
                      onDelete={(id, gid) => requestDelete(id, gid)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {confirmExpense && (
        <ConfirmDialog
          title={language === "tr" ? "Gideri sil" : "Delete expense"}
          body={
            confirmExpense.title
              ? language === "tr"
                ? `"${confirmExpense.title}" gideri silinecek. Bu işlem geri alınabilir.`
                : `"${confirmExpense.title}" will be deleted. This action can be undone.`
              : language === "tr"
                ? "Bu gideri silmek istediğine emin misin?"
                : "Are you sure you want to delete this expense?"
          }
          confirmLabel={String(ui.delete ?? (language === "tr" ? "Sil" : "Delete"))}
          cancelLabel={String(ui.cancel ?? (language === "tr" ? "Vazgeç" : "Cancel"))}
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirmExpense(null)}
        />
      )}

      {/* Projects tab */}
      {walletTab === "projects" && (
        <div className="wallet-tab-panel page-fade">
          <p className="eyebrow" style={{ marginBottom: "1rem" }}>{ui.wProjectExpEyebrow}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {games.filter((g) => !isGeneralGame(g)).map((g) => {
              const spent = g.expenses.reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0);
              const progress = g.budget && g.budget > 0 ? (spent / g.budget) * 100 : 0;
              const isExpanded = expandedId === g.id;

              return (
                <section key={g.id} className="wallet-accordion-card">
                  <div className="wallet-accordion-header" onClick={() => setExpandedId(isExpanded ? null : g.id)}>
                    <div className="wallet-project-left">
                      <div className="wallet-project-avatar">
                        {g.coverDataUrl
                          ? <img src={imgSrc(g.coverDataUrl)} alt={g.title} className="wallet-project-img" />
                          : <span className="wallet-project-initials">{g.title.slice(0, 1)}</span>}
                      </div>
                      <div className="wallet-project-info">
                        <h3 style={{ margin: 0 }}>{g.title}</h3>
                        {g.budget && g.budget > 0 ? (
                          <div className="wallet-budget-row">
                            <div className="wallet-budget-text">
                              <span>$ {spent.toFixed(2)} / $ {g.budget}</span>
                              <span>{progress.toFixed(0)}%</span>
                            </div>
                            <div className="wallet-budget-track">
                              <div className="wallet-budget-fill" style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: progress > 100 ? "var(--status-danger)" : "var(--primary)" }} />
                            </div>
                          </div>
                        ) : (
                          <p className="wallet-sub-copy">{ui.wNoBudgetLimit}</p>
                        )}
                      </div>
                    </div>
                    <div className="wallet-accordion-total">$ {spent.toFixed(2)}</div>
                  </div>

                  <div className={`wallet-accordion ${isExpanded ? "wallet-accordion-open" : ""}`} style={{ borderTop: isExpanded ? "1px solid #ffffff20" : "none" }}>
                    <div className="wallet-expand-body">
                      <div className="wallet-split-grid">
                        <div>
                          <h4 className="wallet-section-h4">"{g.title}" {ui.wExpenseFor}</h4>
                          <ExpenseFormFields
                            form={form}
                            categories={PROJECT_CATEGORIES}
                            gameId={g.id}
                            activeCurrencies={activeCurrencies}
                            titleLabel={ui.wExpenseTitle as string}
                            amountLabel={ui.wAmount as string}
                            currencyLabel={ui.wCurrency as string}
                            categoryLabel={ui.wCategory as string}
                            dateLabel={ui.wDate as string}
                            recurringLabel={ui.wRecurring as string}
                            addLabel={ui.wAdd as string}
                            addProjectLabel={ui.wAddToProject as string}
                            onSubmit={(gid) => void submitExpense(gid)}
                          />
                        </div>
                        <div>
                          <ExpenseDistribution
                            expenses={g.expenses}
                            rate={rate}
                            distLabel={ui.wExpenseDist as string}
                            emptyLabel={distEmptyLabel}
                          />
                          <ExpenseHistory
                            expenses={g.expenses}
                            gameId={g.id}
                            historyLabel={ui.wHistory as string}
                            emptyLabel={noExpensesLabel}
                            rate={rate}
                            onDelete={(id, gid) => requestDelete(id, gid)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
            {games.filter((g) => !isGeneralGame(g)).length === 0 && (
              <p style={{ color: "var(--text-muted)" }}>{ui.wNoProjectsYet}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

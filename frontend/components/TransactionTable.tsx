"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CATEGORIES,
  getTransactions,
  type Category,
  type Transaction,
  updateTransactionCategory,
} from "@/lib/api";
import { categoryLabel } from "@/lib/categories";

function eur(n: number) {
  return `€${n.toFixed(2)}`;
}

export function TransactionTable() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const limit = 50;

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total]);
  const page = useMemo(() => Math.floor(skip / limit) + 1, [skip]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getTransactions({ skip, limit, exclude_internal: true });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  async function onSetCategory(id: number, category: Category) {
    setItems((prev) =>
      prev.map((t) => (t.id === id ? { ...t, category, category_confirmed: true } : t))
    );
    try {
      await updateTransactionCategory(id, category);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      void load();
    }
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-zinc-900/40 shadow-sm backdrop-blur-xl">
      <div className="flex items-center justify-between px-6 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          ТРАНЗАКЦИИ
        </h3>
        <div className="text-xs text-zinc-600">
          Стр. {page} / {pageCount}
        </div>
      </div>

      {error ? (
        <div className="mx-6 mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-y border-white/5 bg-zinc-950/30 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-6 py-3">ДАТА</th>
              <th className="px-6 py-3">ОПИСАНИЕ</th>
              <th className="px-6 py-3">СУММА</th>
              <th className="px-6 py-3">КАТЕГОРИЯ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-6 py-6 text-zinc-500" colSpan={4}>
                  Загружаю...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="px-6 py-6 text-zinc-500" colSpan={4}>
                  Транзакций пока нет.
                </td>
              </tr>
            ) : (
              items.map((t) => (
                <tr key={t.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-6 py-3 font-mono text-xs text-zinc-500">
                    {t.date}
                  </td>
                  <td className="px-6 py-3 text-zinc-200">{t.description}</td>
                  <td className="px-6 py-3 font-medium text-zinc-100">
                    {t.is_debit ? eur(t.amount) : `+${eur(t.amount)}`}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={t.category}
                        onChange={(e) => onSetCategory(t.id, e.target.value as Category)}
                        className="rounded-xl border border-white/10 bg-white/[0.02] px-2 py-1 text-sm text-zinc-200 focus:border-brand-accent/40 focus:ring-0 focus:outline-none"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(c)}
                          </option>
                        ))}
                      </select>
                      {t.category_confirmed ? (
                        <span className="text-xs text-zinc-500">подтв.</span>
                      ) : (
                        <span className="text-xs text-zinc-500">авто</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-6 py-4">
        <button
          type="button"
          className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/[0.03] disabled:opacity-50"
          onClick={() => setSkip((s) => Math.max(0, s - limit))}
          disabled={skip === 0}
        >
          Назад
        </button>
        <button
          type="button"
          className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/[0.03] disabled:opacity-50"
          onClick={() => setSkip((s) => (s + limit < total ? s + limit : s))}
          disabled={skip + limit >= total}
        >
          Далее
        </button>
      </div>
    </div>
  );
}


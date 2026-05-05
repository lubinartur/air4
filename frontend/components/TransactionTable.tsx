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
    <div className="rounded-2xl border border-zinc-100 bg-white shadow-sm">
      <div className="flex items-center justify-between px-6 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Transactions
        </h3>
        <div className="text-xs text-zinc-500">
          Page {page} / {pageCount}
        </div>
      </div>

      {error ? (
        <div className="mx-6 mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-y border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-700">
            <tr>
              <th className="px-6 py-3">Date</th>
              <th className="px-6 py-3">Description</th>
              <th className="px-6 py-3">Amount</th>
              <th className="px-6 py-3">Category</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-6 py-6 text-zinc-600" colSpan={4}>
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="px-6 py-6 text-zinc-500" colSpan={4}>
                  No transactions yet.
                </td>
              </tr>
            ) : (
              items.map((t) => (
                <tr key={t.id} className="border-t border-zinc-100">
                  <td className="px-6 py-3 font-mono text-xs text-zinc-700">
                    {t.date}
                  </td>
                  <td className="px-6 py-3 text-zinc-800">{t.description}</td>
                  <td className="px-6 py-3 font-medium text-zinc-900">
                    {t.is_debit ? eur(t.amount) : `+${eur(t.amount)}`}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={t.category}
                        onChange={(e) => onSetCategory(t.id, e.target.value as Category)}
                        className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-zinc-400 focus:ring-0 focus:outline-none"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(c)}
                          </option>
                        ))}
                      </select>
                      {t.category_confirmed ? (
                        <span className="text-xs text-zinc-500">confirmed</span>
                      ) : (
                        <span className="text-xs text-zinc-500">auto</span>
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
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
          onClick={() => setSkip((s) => Math.max(0, s - limit))}
          disabled={skip === 0}
        >
          Prev
        </button>
        <button
          type="button"
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
          onClick={() => setSkip((s) => (s + limit < total ? s + limit : s))}
          disabled={skip + limit >= total}
        >
          Next
        </button>
      </div>
    </div>
  );
}


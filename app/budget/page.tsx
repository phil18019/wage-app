"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type IncomeRow = {
  id: string;
  label: string;
  amount: string;
};

type OutgoingRow = {
  id: string;
  label: string;
  amount: string;
  dueDate: string;
};

const STORAGE_KEY_BUDGET_INCOME = "paycore.budget.income.v1";
const STORAGE_KEY_BUDGET_OUTGOINGS = "paycore.budget.outgoings.v1";

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseMoney(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtGBP(n: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(n || 0);
}

export default function BudgetPage() {
  const [budgetMonth, setBudgetMonth] = useState("January");
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [outgoingRows, setOutgoingRows] = useState<OutgoingRow[]>([]);
  const [hasLoadedBudget, setHasLoadedBudget] = useState(false);

  useEffect(() => {
    setBudgetMonth(
      new Date().toLocaleString(undefined, { month: "long" })
    );
  }, []);

  useEffect(() => {
    try {
      const savedIncome = JSON.parse(
        localStorage.getItem(STORAGE_KEY_BUDGET_INCOME) ?? "[]"
      );
      const savedOutgoings = JSON.parse(
        localStorage.getItem(STORAGE_KEY_BUDGET_OUTGOINGS) ?? "[]"
      );

      setIncomeRows(Array.isArray(savedIncome) ? savedIncome : []);
      setOutgoingRows(Array.isArray(savedOutgoings) ? savedOutgoings : []);
    } catch {
      setIncomeRows([]);
      setOutgoingRows([]);
    } finally {
      setHasLoadedBudget(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedBudget) return;
    localStorage.setItem(STORAGE_KEY_BUDGET_INCOME, JSON.stringify(incomeRows));
  }, [incomeRows, hasLoadedBudget]);

  useEffect(() => {
    if (!hasLoadedBudget) return;
    localStorage.setItem(STORAGE_KEY_BUDGET_OUTGOINGS, JSON.stringify(outgoingRows));
  }, [outgoingRows, hasLoadedBudget]);

  const totalIncome = useMemo(
    () => incomeRows.reduce((sum, row) => sum + parseMoney(row.amount), 0),
    [incomeRows]
  );

  const totalOutgoings = useMemo(
    () => outgoingRows.reduce((sum, row) => sum + parseMoney(row.amount), 0),
    [outgoingRows]
  );

  const remaining = useMemo(
    () => totalIncome - totalOutgoings,
    [totalIncome, totalOutgoings]
  );

  function addIncomeRow() {
    setIncomeRows((prev) => [
      ...prev,
      { id: makeId(), label: "", amount: "" },
    ]);
  }

  function addOutgoingRow() {
    setOutgoingRows((prev) => [
      ...prev,
      { id: makeId(), label: "", amount: "", dueDate: "" },
    ]);
  }

  function updateIncomeRow(id: string, patch: Partial<IncomeRow>) {
    setIncomeRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function updateOutgoingRow(id: string, patch: Partial<OutgoingRow>) {
    setOutgoingRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function deleteIncomeRow(id: string) {
    setIncomeRows((prev) => prev.filter((row) => row.id !== id));
  }

  function deleteOutgoingRow(id: string) {
    setOutgoingRows((prev) => prev.filter((row) => row.id !== id));
  }

  const card =
    "rounded-2xl overflow-hidden bg-gray-100 border border-gray-200 p-4 shadow dark:bg-white/10 dark:border-white/10";

  const input =
    "mt-1 w-full min-w-0 max-w-full box-border appearance-none rounded-xl bg-white border border-gray-300 px-3 py-2 text-gray-900 dark:bg-white/10 dark:border-white/10 dark:text-white";

  const label = "text-sm text-gray-700 dark:text-white/70";

  if (!hasLoadedBudget) {
    return (
      <div className="min-h-[100dvh] text-[var(--foreground)]">
        <div className="mx-auto max-w-4xl p-4 sm:p-6">
          <div className="text-lg font-semibold">Loading budget...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] text-[var(--foreground)]">
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Budget</div>
            <div className="text-sm text-gray-600 dark:text-white/60">
              Track income, outgoings, and remaining balance.
            </div>
          </div>

          <Link
            href="/app"
            className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
          >
            Back
          </Link>
        </header>

        <div className="space-y-4">
          {/* Month selector */}
          <div className={card}>
            <div className={label}>Month</div>
            <select
              className={input}
              value={budgetMonth}
              onChange={(e) => setBudgetMonth(e.target.value)}
            >
              {[
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
              ].map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>

            <div className="mt-2 text-xs text-gray-600 dark:text-white/60">
              This is a visual reference only and does not change any saved income or outgoings.
            </div>
          </div>

          {/* Income */}
          <div className={card}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-lg font-semibold">Income</div>
              <button
                type="button"
                onClick={addIncomeRow}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 font-semibold text-white"
              >
                Add income
              </button>
            </div>

            <div className="space-y-3">
              {incomeRows.length === 0 ? (
                <div className="text-sm text-gray-600 dark:text-white/60">
                  No income rows yet.
                </div>
              ) : (
                incomeRows.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_160px_100px] gap-2"
                  >
                    <input
                      className={input}
                      value={row.label || ""}
                      onChange={(e) =>
                        updateIncomeRow(row.id, { label: e.target.value })
                      }
                      placeholder="Income source"
                    />

                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      className={input}
                      value={row.amount ?? ""}
                      onChange={(e) =>
                        updateIncomeRow(row.id, { amount: e.target.value })
                      }
                      placeholder="0.00"
                    />

                    <button
                      type="button"
                      onClick={() => deleteIncomeRow(row.id)}
                      className="mt-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Outgoings */}
          <div className={card}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-lg font-semibold">Outgoings</div>
              <button
                type="button"
                onClick={addOutgoingRow}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 font-semibold text-white"
              >
                Add outgoing
              </button>
            </div>

            <div className="space-y-3">
              {outgoingRows.length === 0 ? (
                <div className="text-sm text-gray-600 dark:text-white/60">
                  No outgoing rows yet.
                </div>
              ) : (
                outgoingRows.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_160px_160px_100px] gap-2"
                  >
                    <input
                      className={input}
                      value={row.label || ""}
                      onChange={(e) =>
                        updateOutgoingRow(row.id, { label: e.target.value })
                      }
                      placeholder="Outgoing item"
                    />

                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      className={input}
                      value={row.amount ?? ""}
                      onChange={(e) =>
                        updateOutgoingRow(row.id, { amount: e.target.value })
                      }
                      placeholder="0.00"
                    />

                    <input
                      type="date"
                      className={input}
                      value={row.dueDate || ""}
                      onChange={(e) =>
                        updateOutgoingRow(row.id, { dueDate: e.target.value })
                      }
                    />

                    <button
                      type="button"
                      onClick={() => deleteOutgoingRow(row.id)}
                      className="mt-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Totals */}
          <div className={card}>
            <div className="text-lg font-semibold mb-3">Totals</div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Total income</span>
                <span className="font-semibold text-green-400">
                  {fmtGBP(totalIncome)}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Total outgoings</span>
                <span className="font-semibold text-red-400">
                  {fmtGBP(totalOutgoings)}
                </span>
              </div>

              <div className="border-t border-white/10 pt-3 mt-3 flex justify-between text-base">
                <span className="font-semibold">Remaining</span>
                <span
                  className={`text-lg font-bold ${
                    remaining >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {fmtGBP(remaining)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
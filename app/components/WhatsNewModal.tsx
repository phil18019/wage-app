// app/components/WhatsNewModal.tsx
"use client";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function WhatsNewModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-5 shadow-2xl">
        <div className="text-2xl font-extrabold text-white">🚀 What’s new</div>

        <div className="mt-4 space-y-3 text-sm text-white/90">
          <div>✔ Sick pay rules now support waiting days: 0, 3, 6, or 9</div>
          <div>✔ Consecutive sick shifts now carry correctly across saved months</div>
          <div>✔ Holiday pay now uses real history-based rate calculations</div>
          <div>✔ Improved accuracy across weekly and monthly totals</div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
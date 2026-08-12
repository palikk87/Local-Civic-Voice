export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
      <div className="space-y-4 text-center">
        <div className="w-12 h-12 border-4 border-slate-700 border-t-amber-500 rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm">Loading Civic Voice...</p>
      </div>
    </div>
  );
}

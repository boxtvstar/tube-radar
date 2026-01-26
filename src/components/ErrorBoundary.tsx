import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] bg-slate-900 text-white flex flex-col items-center justify-center p-8 overflow-auto">
          <div className="max-w-2xl w-full bg-slate-800 p-8 rounded-2xl border border-rose-500 shadow-2xl">
             <div className="flex items-center gap-4 mb-6 text-rose-500">
                <span className="material-symbols-outlined text-4xl">warning</span>
                <h1 className="text-2xl font-bold">오류가 발생했습니다 (Application Crash)</h1>
             </div>
             
             <div className="bg-black/50 p-4 rounded-xl font-mono text-sm text-rose-300 mb-6 whitespace-pre-wrap break-all">
                {this.state.error && this.state.error.toString()}
             </div>

             {this.state.errorInfo && (
                <div className="bg-black/30 p-4 rounded-xl font-mono text-xs text-slate-400 mb-6 whitespace-pre-wrap h-64 overflow-y-auto">
                   {this.state.errorInfo.componentStack}
                </div>
             )}

             <div className="flex gap-4">
                 <button 
                   onClick={() => window.location.reload()}
                   className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors"
                 >
                   페이지 새로고침
                 </button>
                 <button 
                   onClick={() => { localStorage.clear(); window.location.reload(); }}
                   className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-colors"
                 >
                   캐시 초기화 및 재시동
                 </button>
             </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

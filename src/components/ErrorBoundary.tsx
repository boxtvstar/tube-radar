import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false
  };

  private timer: NodeJS.Timeout | null = null;

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, showDetails: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
    
    // 2초 지연 후에도 에러 상태가 지속되면 상세 내역 표시 (단순 리로드/로그아웃 시 깜빡임 방지)
    this.timer = setTimeout(() => {
      this.setState({ showDetails: true });
    }, 2000);
  }

  public componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  public render() {
    if (this.state.hasError) {
      if (!this.state.showDetails) {
        // [Transient Phase] 2초간은 단순히 로딩 스피너만 보여줌 (로그아웃 등 리로드 시 자연스럽게 처리됨)
        return (
          <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center">
             <div className="flex flex-col items-center gap-4">
               <div className="size-10 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
               <p className="text-slate-500 text-xs font-medium animate-pulse">잠시만 기다려주세요...</p>
             </div>
          </div>
        );
      }

      // [Persistent Error] 2초 후에도 해결되지 않은 진짜 에러는 상세 표시
      return (
        <div className="fixed inset-0 z-[9999] bg-slate-900 text-white flex flex-col items-center justify-center p-8 overflow-auto animate-in fade-in duration-500">
          <div className="max-w-2xl w-full bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl">
             <div className="flex items-center gap-4 mb-6 text-indigo-400">
                <span className="material-symbols-outlined text-4xl">info</span>
                <h1 className="text-2xl font-bold">시스템 안내</h1>
             </div>
             
             <div className="mb-8 space-y-2">
               <p className="text-slate-300">일시적인 오류가 발생했습니다.</p>
               <p className="text-sm text-slate-500">문제가 지속되면 페이지를 새로고침 해주세요.</p>
             </div>
             
             <div className="bg-black/50 p-4 rounded-xl font-mono text-sm text-slate-400 mb-6 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {this.state.error && this.state.error.toString()}
             </div>

             <div className="flex gap-4">
                 <button 
                   onClick={() => window.location.reload()}
                   className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors"
                 >
                   다시 시도 (새로고침)
                 </button>
                 <button 
                   onClick={() => { localStorage.clear(); window.location.reload(); }}
                   className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-colors"
                 >
                   초기화 및 재시작
                 </button>
             </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

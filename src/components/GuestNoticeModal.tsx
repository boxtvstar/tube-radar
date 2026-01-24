
import React from 'react';

interface GuestNoticeModalProps {
  onClose: () => void;
  userName: string;
  onSubscribe?: () => void;
}

export const GuestNoticeModal: React.FC<GuestNoticeModalProps> = ({ onClose, userName, onSubscribe }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-slate-800 relative">
        
        {/* Decorative Background */}
        <div className="absolute top-0 w-full h-32 bg-gradient-to-br from-indigo-500 to-purple-600 opacity-10 pointer-events-none"></div>
        
        <div className="p-8 pb-0 text-center relative z-10">
           <div className="size-20 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl border-4 border-white dark:border-slate-900">
             <span className="material-symbols-outlined text-4xl animate-pulse">lock_open</span>
           </div>
           
           <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">
             환영합니다, {userName}님!
           </h2>
           <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
             Tube Radar 2.1에 오신 것을 환영합니다.
           </p>
        </div>

        <div className="p-8 space-y-6 relative z-10">
           <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 text-center space-y-3">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300 leading-relaxed word-keep-all">
                멤버십에 가입하셔야 <span className="text-indigo-500 font-black">모든 기능</span>을 이용하실 수 있습니다.<br/><br/>
                현재는 <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs font-bold">무료 둘러보기 모드</span>로,<br/> 
                기능과 디자인만 살펴보실 수 있습니다.
              </p>
           </div>
           
           <div className="flex flex-col gap-3">
              {onSubscribe && (
                <button 
                  onClick={onSubscribe}
                  className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl font-bold transition-all shadow-lg hover:shadow-indigo-500/30 active:scale-[0.98] flex items-center justify-center gap-2 group"
                >
                  <span className="material-symbols-outlined text-lg group-hover:animate-bounce">diamond</span>
                  멤버십 구독하러 가기
                </button>
              )}
              <button 
                onClick={onClose}
                className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold transition-all active:scale-[0.98]"
              >
                무료로 먼저 둘러보기
              </button>
           </div>
           
           <p className="text-[10px] text-center text-slate-400">
             * 멤버십 가입 문의는 관리자에게 연락해주세요.
           </p>
        </div>
      </div>
    </div>
  );
};

import React from 'react';

interface MembershipWelcomeModalProps {
  onClose: () => void;
  userName: string;
  daysLeft: number;
}

export const MembershipWelcomeModal: React.FC<MembershipWelcomeModalProps> = ({ onClose, userName, daysLeft }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-slate-800 relative">
        
        {/* Decorative Particles */}
        <div className="absolute top-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-10 left-10 size-2 bg-yellow-400 rounded-full animate-bounce delay-100"></div>
          <div className="absolute bottom-10 right-10 size-3 bg-indigo-500 rounded-full animate-pulse"></div>
          <div className="absolute top-1/2 right-1/2 size-1 bg-rose-400 rounded-full animate-ping"></div>
        </div>

        <div className="p-8 text-center relative z-10">
           <div className="size-20 bg-gradient-to-br from-yellow-300 to-amber-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-amber-500/20 ring-4 ring-white dark:ring-slate-800">
             <span className="material-symbols-outlined text-4xl text-white animate-bounce-slow">verified</span>
           </div>
           
           <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">
             멤버십 인증 완료!
           </h2>
           <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-6">
             {userName}님, 환영합니다.
           </p>

           <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 text-center space-y-2 mb-6">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300 leading-relaxed word-keep-all">
                명단 확인되어 <span className="text-indigo-500 font-black">즉시 승인</span>되었습니다.
              </p>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 mt-2">
                 <p className="text-xs text-slate-400">남은 멤버십 기간</p>
                 <p className="text-xl font-black text-slate-700 dark:text-white">
                   {daysLeft >= 300 ? '무제한 (Admin)' : `${daysLeft}일`}
                 </p>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                * 멤버십 기간 동안 무료로 이용 가능합니다.
              </p>
           </div>
           
           <button 
             onClick={onClose}
             className="w-full py-3.5 bg-slate-900 hover:bg-black dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-xl font-bold transition-all active:scale-[0.98] shadow-lg"
           >
             Tube Radar 시작하기
           </button>
        </div>
      </div>
    </div>
  );
};

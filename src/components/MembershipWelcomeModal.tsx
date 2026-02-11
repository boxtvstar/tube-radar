import React from 'react';

interface MembershipWelcomeModalProps {
  onClose: () => void;
  userName: string;
  daysLeft: number;
  plan?: string;
  limit?: number;
}

export const MembershipWelcomeModal: React.FC<MembershipWelcomeModalProps> = ({ onClose, userName, daysLeft, plan, limit }) => {
  const getTierName = (p?: string) => {
     if (p === 'gold') return '골드 버튼(Gold)';
     if (p === 'silver') return '실버 버튼(Silver)';
     return '일반(General)';
  };

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

           <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 text-center space-y-4 mb-6">
              <div>
                <span className={`text-xs font-black px-2 py-1 rounded text-white ${plan === 'gold' ? 'bg-amber-500' : 'bg-slate-400'}`}>
                  {getTierName(plan)}
                </span>
                <p className="text-sm font-bold text-slate-900 dark:text-white mt-2">
                  멤버십 등급이 적용되었습니다.
                </p>
              </div>
              
              {limit && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">매일 제공되는 포인트</p>
                    <p className="text-xl font-black text-indigo-600 dark:text-indigo-400">
                      {limit.toLocaleString()} P
                    </p>
                  </div>
              )}

              <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed word-keep-all pt-2">
                명단 확인되어 <span className="text-indigo-500 font-black">즉시 승인</span>처리 되었습니다.
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


import React from 'react';

export const Footer = ({ onOpenModal }: { onOpenModal: (type: 'terms' | 'privacy') => void }) => {

  return (
    <footer className="w-full py-3 px-6 mt-auto border-t border-slate-200 dark:border-slate-800 relative z-10">
      <div className="max-w-screen-2xl mx-auto flex flex-col items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
        
        {/* Row 1: Terms, Privacy, Copyright */}
        <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2">
             <div className="flex gap-4 font-bold text-slate-700 dark:text-slate-300">
                <button onClick={() => onOpenModal('terms')} className="hover:text-indigo-500 transition-colors">이용약관</button>
                <div className="w-px h-2.5 bg-slate-300 dark:bg-slate-700 self-center"></div>
                <button onClick={() => onOpenModal('privacy')} className="hover:text-indigo-500 transition-colors">개인정보처리방침</button>
            </div>
            <div className="hidden sm:block w-px h-2.5 bg-slate-300 dark:bg-slate-700"></div>
            <p className="font-normal text-slate-400 dark:text-slate-600">
                Copyright © 2025 admaker. All Rights Reserved.
            </p>
        </div>

        {/* Row 2: Business Info */}
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 leading-relaxed text-center opacity-80">
            <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">상호명</b> : admaker</span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
            <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">대표자</b> : 현승효</span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
            <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">사업자번호</b> : 591-37-00365</span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
            <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">주소</b> : 인천 연수구 아카데미로312번길 31 402/601</span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
             <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">TEL</b> : 010-4436-2010</span>
             <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
             <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">EMAIL</b> : boxtvstar@gmail.com</span>
             <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
             <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">통신판매업</b> : 준비중</span>
        </div>

      </div>
    </footer>
  );
};

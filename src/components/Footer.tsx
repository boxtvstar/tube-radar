import React, { useState } from 'react';

export const Footer = () => {
  const [modalType, setModalType] = useState<'none' | 'terms' | 'privacy'>('none');

  return (
    <footer className="w-full py-3 px-6 mt-auto border-t border-slate-200 dark:border-slate-800 relative z-10">
      <div className="max-w-screen-2xl mx-auto flex flex-col items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
        
        {/* Row 1: Terms, Privacy, Copyright */}
        <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2">
             <div className="flex gap-4 font-bold text-slate-700 dark:text-slate-300">
                <button onClick={() => setModalType('terms')} className="hover:text-indigo-500 transition-colors">이용약관</button>
                <div className="w-px h-2.5 bg-slate-300 dark:bg-slate-700 self-center"></div>
                <button onClick={() => setModalType('privacy')} className="hover:text-indigo-500 transition-colors">개인정보처리방침</button>
            </div>
            <div className="hidden sm:block w-px h-2.5 bg-slate-300 dark:bg-slate-700"></div>
            <p className="font-normal text-slate-400 dark:text-slate-600">
                Copyright © 2024 admaker. All Rights Reserved.
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
            <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">주소</b> : 울산 남구 달동 1313-16</span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
             <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">TEL</b> : 010-123-1234</span>
             <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
             <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">EMAIL</b> : boxtvstar@gmail.com</span>
             <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
             <span className="whitespace-nowrap"><b className="text-slate-700 dark:text-slate-300">통신판매업</b> : 준비중</span>
        </div>

      </div>

      {/* Modals (Simple Overlay) */}
      {modalType !== 'none' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setModalType('none')}>
            <div 
                className="bg-white dark:bg-slate-900 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 ring-1 ring-white/10" 
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900">
                    <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                        {modalType === 'terms' ? '이용약관' : '개인정보처리방침'}
                    </h3>
                    <button onClick={() => setModalType('none')} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <span className="material-symbols-outlined text-slate-500">close</span>
                    </button>
                </div>
                
                <div className="p-8 overflow-y-auto custom-scrollbar flex-1">
                    <div className="prose dark:prose-invert prose-sm max-w-none text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
                        {modalType === 'terms' ? (
                            `제1조 (목적)\n본 약관은 admaker(이하 "회사")가 제공하는 TUBE RADAR 서비스(이하 "서비스")의 이용조건 및 절차, 이용자와 회사의 권리, 의무, 책임사항을 규정함을 목적으로 합니다.\n\n제2조 (용어의 정의)\n(추후 업데이트 예정입니다.)`
                        ) : (
                            `1. 개인정보의 수집 및 이용 목적\n회사는 서비스 제공을 위해 필요한 최소한의 개인정보를 수집하고 있습니다.\n\n2. 수집하는 개인정보의 항목\n- 필수항목: 이메일, 프로필사진, 이름(닉네임)\n\n(추후 업데이트 예정입니다.)`
                        )}
                    </div>
                </div>
                
                <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-right">
                    <button onClick={() => setModalType('none')} className="px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold hover:opacity-90 transition-opacity text-sm">확인</button>
                </div>
            </div>
        </div>
      )}
    </footer>
  );
};

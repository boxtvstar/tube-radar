import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export const PendingApproval = () => {
  const { logout, user } = useAuth();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="mb-6 flex justify-center">
          <div className="size-16 bg-yellow-500/10 rounded-full flex items-center justify-center border border-yellow-500/20">
            <span className="material-symbols-outlined text-3xl text-yellow-500">hourglass_top</span>
          </div>
        </div>
        
        <h1 className="text-2xl font-bold text-white mb-2">
          가입 승인 대기 중
        </h1>
        <p className="text-gray-400 mb-6 text-sm">
          현재 <span className="text-white font-bold">{user?.displayName}</span> 님의 계정은<br/>관리자 승인 대기 상태입니다.
        </p>
        
        <div className="bg-gray-800/50 rounded-lg p-4 mb-8 text-xs text-gray-500">
          승인이 완료되면 서비스를 정상적으로 이용하실 수 있습니다.<br/>
          잠시만 기다려주세요.
        </div>

        <button
          onClick={logout}
          className="w-full bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">logout</span>
          로그아웃
        </button>
      </div>
    </div>
  );
};

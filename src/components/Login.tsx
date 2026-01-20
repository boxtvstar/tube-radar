import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export const Login = () => {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center shadow-2xl">
        <div className="mb-6 flex justify-center">
          <div className="size-16 bg-gradient-to-tr from-pink-500 to-violet-500 rounded-xl flex items-center justify-center shadow-lg shadow-pink-500/20">
            <span className="material-symbols-outlined text-[40px] text-white">radar</span>
          </div>
        </div>
        
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent mb-2">
          Tube Radar 2.1
        </h1>
        <p className="text-gray-400 mb-8">
          유튜브 트렌드 분석 및 채널 모니터링을 시작하세요.
        </p>

        <button
          onClick={signInWithGoogle}
          className="w-full bg-white text-black font-semibold py-3 px-6 rounded-xl hover:bg-gray-200 transition-all flex items-center justify-center gap-3"
        >
          <img 
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" 
            alt="Google" 
            className="w-5 h-5"
          />
          Google 계정으로 계속하기
        </button>

        <p className="mt-6 text-xs text-gray-600">
          로그인시 이용약관 및 개인정보처리방침에 동의하게 됩니다.
        </p>
      </div>
    </div>
  );
};

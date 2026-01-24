import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { sendInquiry } from '../../services/dbService';

export const PaymentResult = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'failed'>('loading');
  const [message, setMessage] = useState('결제 결과를 확인 중입니다...');

  useEffect(() => {
    const processPayment = async () => {
      // Parse URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const resultCode = urlParams.get('resultCode'); // NicePay success is '0000'
      const resultMsg = urlParams.get('resultMsg');
      const authKey = urlParams.get('authKey') || urlParams.get('tid'); // Transaction ID or Auth Key
      const amount = urlParams.get('amt') || urlParams.get('amount'); // Check both just in case

      console.log("Payment Result Params:", { resultCode, resultMsg, authKey, amount });

      if (resultCode !== '0000') {
        setStatus('failed');
        setMessage(decodeURIComponent(resultMsg || '') || '결제가 취소되었거나 실패했습니다.');
        return;
      }

      // In client-side flow (Test), we consider authKey existence as success
      // In production (Server Auth), we would send this authKey to our backend to confirm
      if (authKey) {
        try {
          // Log success to DB as an inquiry for now (since we don't have a backend function yet)
          // This allows you to verify it in Admin Dashboard
          if (user) {
            await sendInquiry(
              user.uid,
              user.displayName || 'Subscribing User',
              `[SYSTEM] 결제 성공 보고\n주문번호: ${urlParams.get('orderId')}\n승인키: ${authKey}\n금액: ${amount}\n메시지: ${decodeURIComponent(resultMsg || '')}`
            );
          }
          setStatus('success');
          setMessage('결제가 성공적으로 완료되었습니다! 멤버십이 곧 활성화됩니다.');
        } catch (e) {
          console.error("DB Log Error:", e);
          setStatus('success'); // Still success for the user
          setMessage('결제는 성공했으나 기록 저장 중 문제가 발생했습니다. 관리자에게 문의해주세요.');
        }
      } else {
        setStatus('failed');
        setMessage('인증 키 확인에 실패했습니다.');
      }
    };

    processPayment();
  }, [user]);

  const handleGoHome = () => {
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md p-8 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 text-center space-y-6 animate-in zoom-in-95 duration-300">
        
        {/* Icon */}
        <div className="flex justify-center">
          {status === 'loading' && (
            <div className="size-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
          )}
          {status === 'success' && (
            <div className="size-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center border-4 border-emerald-500/20 animate-in bounce-in">
              <span className="material-symbols-outlined text-4xl font-bold">check</span>
            </div>
          )}
          {status === 'failed' && (
            <div className="size-20 bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center border-4 border-rose-500/20 animate-in shake">
              <span className="material-symbols-outlined text-4xl font-bold">priority_high</span>
            </div>
          )}
        </div>

        {/* Text */}
        <div className="space-y-2">
          <h2 className="text-2xl font-black text-slate-900 dark:text-white">
            {status === 'loading' ? '결제 확인 중...' : (status === 'success' ? '결제 성공!' : '결제 실패')}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
            {message}
          </p>
        </div>

        {/* Button */}
        {status !== 'loading' && (
          <button
            onClick={handleGoHome}
            className={`w-full py-4 rounded-xl font-bold text-white transition-all transform hover:scale-[1.02] shadow-lg ${
              status === 'success' 
                ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30' 
                : 'bg-slate-700 hover:bg-slate-800 shadow-slate-700/30'
            }`}
          >
            홈으로 돌아가기
          </button>
        )}
      </div>
    </div>
  );
};

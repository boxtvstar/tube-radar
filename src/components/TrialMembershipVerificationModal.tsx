import React, { useState } from 'react';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

export const TrialMembershipVerificationModal = ({ onClose }: { onClose: () => void }) => {
  const { user } = useAuth();
  const [channelInput, setChannelInput] = useState('');
  const [inputStatus, setInputStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [result, setResult] = useState<{ type: 'success' | 'info' | 'error'; title: string; message: React.ReactNode } | null>(null);

  const handleChannelIdSubmit = async () => {
    if (!user || !channelInput.trim()) return;

    setInputStatus('checking');
    let cleanId = channelInput.trim();

    try {
      if (cleanId.includes('youtube.com') || cleanId.includes('youtu.be')) {
        if (cleanId.includes('/channel/')) {
          cleanId = cleanId.split('/channel/')[1].split('/')[0].split('?')[0];
        }
      }
    } catch (error) {
      console.error(error);
    }

    try {
      const whitelistRef = doc(db, 'system_data', 'membership_whitelist');
      const whitelistSnap = await getDoc(whitelistRef);
      let isMatched = false;

      if (whitelistSnap.exists()) {
        const whitelist = whitelistSnap.data();
        const details = (whitelist.memberDetails as any[]) || [];
        isMatched = details.some((member) => member.id === cleanId);
      }

      const usersRef = collection(db, 'users');
      const duplicateQuery = query(usersRef, where('channelId', '==', cleanId));
      const duplicateSnapshot = await getDocs(duplicateQuery);
      const otherUsers = duplicateSnapshot.docs.filter((snapshot) => snapshot.id !== user.uid);

      if (otherUsers.length > 0) {
        setInputStatus('invalid');
        setResult({
          type: 'error',
          title: '이미 등록된 채널 ID입니다.',
          message: (
            <>
              <p>입력하신 채널 ID(<b>{cleanId}</b>)는 이미 다른 계정과 연동되어 있습니다.</p>
              <p className="mt-2 text-slate-500 dark:text-slate-400">본인 채널이 맞다면 관리자에게 문의해주세요.</p>
            </>
          )
        });
        return;
      }

      await updateDoc(doc(db, 'users', user.uid), {
        channelId: cleanId,
        submittedAt: new Date().toISOString()
      });

      if (isMatched) {
        setInputStatus('valid');
        setResult({
          type: 'success',
          title: '인증 성공!',
          message: (
            <>
              <p className="font-mono text-xs text-indigo-500 dark:text-indigo-300 mb-2">({cleanId})</p>
              <p>잠시 후 승인 상태가 갱신됩니다.</p>
            </>
          )
        });
        return;
      }

      setInputStatus('valid');
      setResult({
        type: 'info',
        title: '인증 요청이 접수되었습니다.',
        message: (
          <>
            <p className="font-mono text-xs text-sky-600 dark:text-sky-300 mb-2">({cleanId})</p>
            <p>채널 ID는 저장되었습니다. 명단 대조 후 자동 승인되지 않으면 관리자 확인 후 이용할 수 있습니다.</p>
          </>
        )
      });
    } catch (error) {
      console.error(error);
      setInputStatus('invalid');
      setResult({
        type: 'error',
        title: '인증 중 오류가 발생했습니다.',
        message: '잠시 후 다시 시도해주세요.'
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-500">Trial Access</p>
            <h3 className="mt-1 text-xl font-black text-slate-900 dark:text-white">멤버십 인증</h3>
          </div>
          <button
            onClick={onClose}
            className="size-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-sky-500">verified_user</span>
                채널 ID로 자동 인증
              </div>
              <a
                href="https://www.youtube.com/account_advanced"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-indigo-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1"
              >
                채널 ID 확인
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
              </a>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={channelInput}
                onChange={(event) => setChannelInput(event.target.value)}
                placeholder="채널 ID 입력 또는 /channel/ 주소 붙여넣기"
                className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10"
              />
              <button
                onClick={handleChannelIdSubmit}
                disabled={inputStatus === 'checking'}
                className="px-5 py-3 rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white text-sm font-black transition-all whitespace-nowrap"
              >
                {inputStatus === 'checking' ? '확인 중...' : '인증 확인'}
              </button>
            </div>

            <p className="mt-3 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
              유튜브 고급 설정에서 채널 ID를 복사한 뒤 붙여넣으면, 멤버십 명단과 대조해 승인합니다.
            </p>
          </div>

          {result && (
            <div
              className={`rounded-[1.5rem] border p-4 ${
                result.type === 'success'
                  ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10'
                  : result.type === 'info'
                    ? 'border-sky-200 dark:border-sky-500/20 bg-sky-50 dark:bg-sky-500/10'
                    : 'border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`material-symbols-outlined mt-0.5 ${
                    result.type === 'success' ? 'text-emerald-500' : result.type === 'info' ? 'text-sky-500' : 'text-rose-500'
                  }`}
                >
                  {result.type === 'success' ? 'check_circle' : result.type === 'info' ? 'schedule' : 'error'}
                </span>
                <div>
                  <p className="text-sm font-black text-slate-900 dark:text-white">{result.title}</p>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{result.message}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

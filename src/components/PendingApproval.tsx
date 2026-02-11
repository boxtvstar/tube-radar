import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { collection, addDoc, updateDoc, doc, getDoc, query, where, getDocs } from 'firebase/firestore'; // Added query, where, getDocs
import { db } from '../lib/firebase';

export const PendingApproval = () => {
  const { logout, user } = useAuth();
  const [isMessaging, setIsMessaging] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  // Choose Result Modal State
  const [resultModal, setResultModal] = useState<{ type: 'success' | 'error', title: string, message: React.ReactNode } | null>(null);

  // Channel ID Input State
  const [channelInput, setChannelInput] = useState('');
  const [inputStatus, setInputStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');


  const handleSendMessage = async () => {
    if (!message.trim()) return;
    setIsSending(true);
    try {
      await addDoc(collection(db, 'inquiries'), {
        userId: user?.uid,
        userName: user?.displayName,
        userEmail: user?.email,
        content: message,
        createdAt: new Date().toISOString(),
        isAnswered: false,
        type: 'approval_request'
      });
      setResultModal({
        type: 'success',
        title: '문의가 접수되었습니다',
        message: (
           <>
              <p>관리자가 내용을 확인한 후</p>
              <p className="mt-1">빠르게 처리해 드리겠습니다.</p>
           </>
        )
      });
      setIsMessaging(false);
      setMessage('');
    } catch (e) {
      setResultModal({
        type: 'error',
        title: '전송 실패',
        message: '잠시 후 다시 시도해주세요.'
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleChannelIdSubmit = async () => {
     if (!channelInput.trim()) return;
     setInputStatus('checking');
     
     // Basic cleanup of input to get ID or Handle
     let cleanId = channelInput.trim();
     
     // Support full URL pasting
     try {
        if (cleanId.includes('youtube.com') || cleanId.includes('youtu.be')) {
            if (cleanId.includes('/channel/')) {
               cleanId = cleanId.split('/channel/')[1].split('/')[0].split('?')[0];
            } 
        }
     } catch (e) { console.log(e); }

     try {
       // 1. Direct Verification against Whitelist
       const whitelistRef = doc(db, 'system_data', 'membership_whitelist');
       const whitelistSnap = await getDoc(whitelistRef);
       let isMatched = false;

       if (whitelistSnap.exists()) {
          const whitelist = whitelistSnap.data();
          const details = whitelist.memberDetails as any[] || [];
          isMatched = details.some(m => m.id === cleanId);
       }

       // 2. CHECK DUPLICATE (Global Security)
       // Ensure NO OTHER USER is using this ID, regardless of whitelist status.
       const usersRef = collection(db, 'users');
       const q = query(usersRef, where('channelId', '==', cleanId));
       const querySnapshot = await getDocs(q);
       
       // Filter out current user (in case they saved it before)
       const otherUsers = querySnapshot.docs.filter(d => d.id !== user?.uid);
       
       if (otherUsers.length > 0) {
          setInputStatus('invalid');
          setResultModal({
              type: 'error',
              title: '이미 등록된 채널 ID입니다.', // Clearer message
              message: (
                 <>
                    <p>입력하신 채널 ID(<b>{cleanId}</b>)는<br/>이미 다른 계정과 연동되어 있습니다.</p>
                    <p className="mt-2 text-slate-400">본인의 채널이 맞다면 관리자에게 문의해주세요.</p>
                 </>
              )
          });
          return; 
       }

       if (isMatched) {
           // (Duplicate check already done above)
       }

       // 3. Save ID to profile (Safe to save now if matched and unique, or if not matched)
       await updateDoc(doc(db, 'users', user?.uid), {
         channelId: cleanId,
         submittedAt: new Date().toISOString()
       });

       if (isMatched) {
           setInputStatus('valid');
           setResultModal({
               type: 'success',
               title: '인증 성공!',
               message: (
                  <>
                    <p className="font-mono text-xs text-indigo-300 mb-2">({cleanId})</p>
                    <p>잠시 후 승인이 완료되어<br/>메인 화면으로 이동합니다.</p>
                  </>
               )
           });
       } else {
           setInputStatus('invalid');
           setResultModal({
               type: 'error',
               title: '멤버십 기록에서 확인할 수 없습니다.',
               message: (
                  <>
                     <p>방금 가입하셨다면 아래 <b>[문의하기]</b>로<br/>관리자에게 메세지를 보내시거나</p>
                     <p className="mt-2 text-slate-400">내일 다시 확인 해주세요!</p>
                  </>
               )
           });
       }
     } catch (e) {
       console.error(e);
       setInputStatus('invalid');
       alert('오류가 발생했습니다. 다시 시도해주세요.');
     }
  };

  // Fetch Inquiries Query
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [loadingInquiries, setLoadingInquiries] = useState(false);
  const [showInquiries, setShowInquiries] = useState(false); // Toggle state

  const fetchInquiries = async () => {
    if (!user?.uid) return;
    setLoadingInquiries(true);
    try {
      const q = query(collection(db, 'inquiries'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => b.createdAt - a.createdAt);
      setInquiries(data);
    } catch (e) {
      console.error("Failed to fetch inquiries", e);
    } finally {
      setLoadingInquiries(false);
    }
  };

  React.useEffect(() => {
    fetchInquiries();
  }, [user]);

  const answeredCount = inquiries.filter(i => i.isAnswered).length;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4 relative overflow-y-auto">
      <div className="max-w-md w-full bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center shadow-2xl animate-in fade-in zoom-in duration-300 my-10">
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

        {/* Channel ID Input Section (Manual Verification) */}
        <div className="bg-slate-800 rounded-xl p-5 mb-6 border border-slate-700">
           <div className="flex justify-between items-end mb-2">
              <div className="text-left text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                 <span className="material-symbols-outlined text-sm">verified_user</span>
                 멤버십 인증 (자동 승인)
              </div>
              <a 
                href="https://www.youtube.com/account_advanced" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[10px] text-indigo-400 hover:text-indigo-300 underline flex items-center gap-0.5"
              >
                 내 채널 ID 확인하기
                 <span className="material-symbols-outlined text-[10px]">open_in_new</span>
              </a>
           </div>
           <div className="flex gap-2">
              <input 
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                placeholder="채널 ID (예: UC...)"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none placeholder:text-slate-600 font-bold"
              />
              <button 
                onClick={handleChannelIdSubmit}
                disabled={inputStatus === 'checking'}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 rounded-lg text-xs transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {inputStatus === 'checking' ? '저장 중...' : '확인'}
              </button>
           </div>
           <p className="text-[10px] text-slate-500 mt-2 text-left leading-relaxed">
             * 위 링크에서 <span className="text-emerald-500 font-bold">'채널 ID'</span>를 복사하여 붙여넣고 [확인]을 눌러주세요.<br/>
             멤버십 명단과 대조하여 즉시 승인됩니다.
           </p>
        </div>

        {/* Join Membership Button */}
        <div className="mb-4">
             <a 
               href="https://www.youtube.com/channel/UClP2hW295JL_o-lESiMY0fg/join" 
               target="_blank" 
               rel="noopener noreferrer"
               className="block w-full py-3 bg-[#CC0000] hover:bg-[#FF0000] text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-900/20"
             >
                <span className="material-symbols-outlined">favorite</span>
                멤버십 가입하러 가기
             </a>
             <p className="text-[10px] text-gray-500 mt-2">
                * 멤버십 회원이 아니신가요? 가입 후 위에서 인증해주세요.
             </p>
        </div>

        {/* Message Admin Section */}
        {isMessaging ? (
           <div className="bg-gray-800/50 rounded-xl p-4 mb-4 border border-gray-700">
              <div className="text-left text-xs font-bold text-slate-400 mb-2">관리자에게 문의하기</div>
              <textarea 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="문의하실 내용을 입력해주세요."
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-yellow-500 mb-2 h-24 resize-none"
              />
              <div className="flex gap-2">
                 <button 
                   onClick={() => setIsMessaging(false)}
                   className="flex-1 py-2 bg-gray-700 text-gray-300 font-bold rounded-lg text-xs hover:bg-gray-600 transition-colors"
                 >
                   취소
                 </button>
                 <button 
                   onClick={() => { handleSendMessage().then(fetchInquiries); }}
                   disabled={isSending}
                   className="flex-1 py-2 bg-yellow-600 text-white font-bold rounded-lg text-xs hover:bg-yellow-500 transition-colors disabled:opacity-50"
                 >
                   {isSending ? '전송 중...' : '전송하기'}
                 </button>
              </div>
           </div>
        ) : (
           <button 
             onClick={() => setIsMessaging(true)}
             className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-yellow-500 font-bold rounded-xl transition-all mb-4 flex items-center justify-center gap-2 text-sm border border-transparent hover:border-yellow-500/30"
           >
              <span className="material-symbols-outlined text-lg">mail</span>
              승인 요청 / 문의하기
           </button>
        )}
        
        {/* Inquiry History Toggle Button (Modified) */}
        {inquiries.length > 0 && (
           <div className="mb-4 text-left w-full">
              {!showInquiries ? (
                 <button 
                   onClick={() => setShowInquiries(true)}
                   className={`w-full p-4 rounded-xl flex items-center justify-between transition-all ${
                      answeredCount > 0 
                      ? 'bg-gradient-to-r from-emerald-600/20 to-emerald-900/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/30' 
                      : 'bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-700'
                   }`}
                 >
                    <div className="flex items-center gap-3">
                       <div className={`size-8 rounded-full flex items-center justify-center ${answeredCount > 0 ? 'bg-emerald-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400'}`}>
                          <span className="material-symbols-outlined text-lg">
                             {answeredCount > 0 ? 'mark_email_unread' : 'history'}
                          </span>
                       </div>
                       <div className="text-left">
                          <div className={`text-sm font-bold ${answeredCount > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                             {answeredCount > 0 ? '답변이 도착했습니다!' : '보낸 문의 내역'}
                          </div>
                          <div className="text-[10px] opacity-70">
                             {answeredCount > 0 ? `새로운 메세지가 ${answeredCount}개 있습니다` : `총 ${inquiries.length}건의 문의가 있습니다`}
                          </div>
                       </div>
                    </div>
                    <span className="material-symbols-outlined">expand_more</span>
                 </button>
              ) : (
                 <div className="bg-slate-800/30 rounded-xl border border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between p-3 border-b border-slate-700 bg-slate-800/50">
                       <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm">list_alt</span>
                          문의 내역 ({inquiries.length})
                       </span>
                       <div className="flex items-center gap-2">
                          <button onClick={fetchInquiries} className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 bg-slate-800 px-2 py-1 rounded">
                             <span className="material-symbols-outlined text-[10px]">refresh</span>
                             새로고침
                          </button>
                          <button onClick={() => setShowInquiries(false)} className="text-slate-400 hover:text-white p-1">
                             <span className="material-symbols-outlined text-lg">close</span>
                          </button>
                       </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto custom-scrollbar p-2 space-y-2">
                       {inquiries.map((inquiry) => (
                          <div key={inquiry.id} className={`p-3 rounded-lg border ${inquiry.isAnswered ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-slate-900 border-slate-800'}`}>
                             <div className="flex justify-between items-start mb-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                   inquiry.isAnswered 
                                   ? 'bg-emerald-500/20 text-emerald-400' 
                                   : 'bg-slate-700 text-slate-400'
                                }`}>
                                   {inquiry.isAnswered ? '답변 완료' : '대기 중'}
                                </span>
                                <span className="text-[10px] text-slate-500">{new Date(inquiry.createdAt).toLocaleDateString()}</span>
                             </div>
                             <p className="text-xs text-slate-300 font-medium whitespace-pre-wrap mb-2 leading-relaxed">
                                Q. {inquiry.content}
                             </p>
                             {inquiry.isAnswered && inquiry.answer && (
                                <div className="mt-2 pt-2 border-t border-slate-700/50">
                                   <div className="flex items-center gap-1.5 mb-1">
                                      <span className="material-symbols-outlined text-[12px] text-yellow-500">subdirectory_arrow_right</span>
                                      <span className="text-[10px] font-bold text-yellow-500">관리자 답변</span>
                                   </div>
                                   <p className="text-xs text-white bg-slate-800 p-2 rounded-lg leading-relaxed whitespace-pre-wrap border border-slate-700">
                                      {inquiry.answer}
                                   </p>
                                </div>
                             )}
                          </div>
                       ))}
                    </div>
                 </div>
              )}
           </div>
        )}

        {!isMessaging && (
           <div className="bg-gray-800/50 rounded-lg p-4 mb-4 text-xs text-gray-500">
             승인이 완료되면 서비스를 정상적으로 이용하실 수 있습니다.<br/>
             (자동 인증 시 즉시 이용 가능)
           </div>
        )}

        <button
          onClick={logout}
          className="w-full text-gray-500 hover:text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
        >
          <span className="material-symbols-outlined text-lg">logout</span>
          로그아웃
        </button>
      </div>

      {/* Result Modal Overlay */}
      {resultModal && (
         <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className={`w-full max-w-sm bg-slate-900 rounded-2xl p-6 border ${resultModal.type === 'success' ? 'border-indigo-500/50 shadow-indigo-500/20' : 'border-rose-500/50 shadow-rose-500/20'} shadow-2xl animate-in zoom-in duration-200`}>
               <div className="flex flex-col items-center text-center">
                  <div className={`size-14 rounded-full flex items-center justify-center mb-4 ${resultModal.type === 'success' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-rose-500/20 text-rose-400'}`}>
                     <span className="material-symbols-outlined text-3xl">
                        {resultModal.type === 'success' ? 'check_circle' : 'error'}
                     </span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">
                     {resultModal.title}
                  </h3>
                  <div className="text-slate-300 text-sm leading-relaxed mb-6">
                     {resultModal.message}
                  </div>
                  <button 
                     onClick={() => setResultModal(null)}
                     className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                        resultModal.type === 'success' 
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40' 
                        : 'bg-slate-800 hover:bg-slate-700 text-white'
                     }`}
                  >
                     확인
                  </button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};

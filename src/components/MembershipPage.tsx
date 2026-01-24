import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

// NicePay Script Type Declaration
declare global {
  interface Window {
    NicePay: any;
  }
}

export const MembershipPage = () => {
  const { user } = useAuth();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [isSdkLoaded, setIsSdkLoaded] = useState(false);

  useEffect(() => {
    // Load NicePay Script (Standard V1)
    const script = document.createElement('script');
    script.src = "https://pay.nicepay.co.kr/v1/js/";
    script.async = true;
    
    script.onload = () => {
      console.log("NicePay SDK script loaded");
      // Manual says to use AUTHNICE object
      if ((window as any).AUTHNICE) {
        console.log("AUTHNICE object found");
        setIsSdkLoaded(true);
      } else {
        console.error("SDK loaded but AUTHNICE object not found");
      }
    };

    script.onerror = () => {
      console.error("Failed to load NicePay SDK");
      alert("결제 모듈 로드에 실패했습니다. (Network/Blocker Issue)");
    };

    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const plans = [
    {
      id: 'free',
      name: 'Free',
      price: '₩0',
      period: 'forever',
      description: '기본적인 채널 분석 기능을 체험해보세요.',
      features: [
        '기본 채널 분석 (일 5회)',
        '최근 영상 10개 조회',
        '커뮤니티 이용 가능',
        '광고 포함'
      ],
      cta: '현재 이용 중',
      popular: false,
      disabled: true
    },
    {
      id: 'pro',
      name: 'Pro',
      price: billingCycle === 'monthly' ? '₩19,900' : '₩199,000',
      period: billingCycle === 'monthly' ? '/월' : '/연',
      save: billingCycle === 'yearly' ? '2개월분 할인' : null,
      description: '전문적인 채널 분석과 무제한 인사이트.',
      features: [
        '무제한 채널 분석',
        '실시간 트렌드 추적',
        '영상 성과 예측 AI',
        '경쟁 채널 비교 분석',
        '광고 제거',
        '프리미엄 고객 지원'
      ],
      cta: '신청하기',
      popular: true,
      disabled: false
    }
  ];

  const handleSubscribe = (planId: string) => {
    if (planId === 'free') return;
    
    // Check for AUTHNICE object
    const nicePay = (window as any).AUTHNICE;

    if (!nicePay) {
       alert("결제 모듈을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
       return;
    }

    // Verify Client Key
    // Hardcoded for debugging to ensure no .env issues first, then switch back to env
    const clientKey = "S2_0f00dc1ab0594022bf7d365a00587375"; 
    
    console.log("Requesting Payment via AUTHNICE.requestPay");

    try {
      nicePay.requestPay({
        clientId: clientKey,
        method: 'card', 
        orderId: 'tr_' + Date.now(), 
        amount: billingCycle === 'monthly' ? 19900 : 199000,
        goodsName: "TubeRadar Pro Subscription", 
        returnUrl: window.location.origin + '?mode=payment_result', 
        fnError: function (result: any) {
          console.error("NicePay Error:", result);
          alert(`결제 실패: ${result.msg || 'Unknown Error'}`);
        }
      });
    } catch (e: any) {
      console.error("NicePay Request Failed:", e);
      alert("결제 요청 중 오류가 발생했습니다: " + e.message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-black min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4 pt-10">
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight">
            당신의 채널 성장을 위한 <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-600">최고의 투자</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-lg max-w-2xl mx-auto">
            데이터 기반의 인사이트로 유튜브 성장을 가속화하세요.
            <br className="hidden md:block"/> 
            합리적인 가격으로 전문가급 분석 도구를 제공합니다.
          </p>
        </div>

        {/* Toggle */}
        <div className="flex justify-center">
          <div className="bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center shadow-sm">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
              }`}
            >
              월간 결제
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                billingCycle === 'yearly'
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
              }`}
            >
              연간 결제
              <span className="bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[10px] px-1.5 py-0.5 rounded-md shadow-sm animate-pulse">
                SALE
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {plans.map((plan) => (
            <div 
              key={plan.id}
              className={`relative bg-white dark:bg-slate-900 rounded-3xl p-8 border transition-all duration-300 hover:scale-[1.02] flex flex-col ${
                plan.popular 
                  ? 'border-indigo-500 ring-4 ring-indigo-500/10 shadow-2xl shadow-indigo-500/10 z-10' 
                  : 'border-slate-200 dark:border-slate-800 shadow-xl'
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-indigo-500 text-white px-4 py-1 rounded-full text-xs font-bold shadow-lg shadow-indigo-500/30">
                  MOST POPULAR
                </div>
              )}

              <div className="mb-8">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black text-slate-900 dark:text-white">{plan.price}</span>
                  <span className="text-slate-500 font-medium">{plan.period}</span>
                </div>
                {plan.save && (
                  <p className="text-xs font-bold text-emerald-500 mt-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">trending_down</span>
                    {plan.save}
                  </p>
                )}
                <p className="text-slate-500 text-sm mt-4 leading-relaxed">
                  {plan.description}
                </p>
              </div>

              <div className="flex-1">
                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                      <span className={`material-symbols-outlined text-lg ${plan.popular ? 'text-indigo-500' : 'text-slate-400'}`}>check_circle</span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={plan.disabled}
                className={`w-full py-4 rounded-xl font-bold text-sm transition-all ${
                  plan.disabled
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/50'
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* FAQ Section */}
        <div className="pt-10 border-t border-slate-200 dark:border-slate-800">
          <h3 className="text-center text-xl font-bold text-slate-900 dark:text-white mb-8">자주 묻는 질문</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
             <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
                <h4 className="font-bold mb-2 dark:text-slate-200">언제든지 해지할 수 있나요?</h4>
                <p className="text-sm text-slate-500">네, 설정 페이지에서 언제든지 구독을 해지하실 수 있으며 추가 비용은 발생하지 않습니다.</p>
             </div>
             <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
                <h4 className="font-bold mb-2 dark:text-slate-200">환불 정책은 어떻게 되나요?</h4>
                <p className="text-sm text-slate-500">결제 후 7일 이내 사용 이력이 없는 경우 전액 환불이 가능합니다.</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

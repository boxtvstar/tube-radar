import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

// ── Intersection Observer 훅 ──
const useInView = (threshold = 0.15) => {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
};

// ── 카운트업 애니메이션 ──
const CountUp = ({ end, suffix = '', duration = 2000 }: { end: number; suffix?: string; duration?: number }) => {
  const [count, setCount] = useState(0);
  const { ref, inView } = useInView(0.3);
  useEffect(() => {
    if (!inView) return;
    const start = 0;
    const step = Math.ceil(end / (duration / 16));
    let current = start;
    const timer = setInterval(() => {
      current += step;
      if (current >= end) { setCount(end); clearInterval(timer); }
      else setCount(current);
    }, 16);
    return () => clearInterval(timer);
  }, [inView, end, duration]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
};

// ── 기능 데이터 ──
const FEATURES = [
  {
    icon: 'radar',
    title: '채널 레이더',
    subtitle: '실시간 바이럴 탐지',
    desc: '지금 이 순간 급상승하는 영상을 실시간으로 포착합니다. 조회수 폭발 직전의 영상을 누구보다 빠르게 발견하세요.',
    tags: ['실시간', '바이럴 탐지', 'AI 분석'],
    gradient: 'from-violet-500 to-indigo-500',
    bgGlow: 'bg-violet-500/10',
  },
  {
    icon: 'explore',
    title: '소재 탐색기',
    subtitle: 'AI 기반 콘텐츠 추천',
    desc: 'AI가 트렌드를 분석해 다음에 만들 콘텐츠 아이디어를 추천합니다. 더 이상 소재 고민에 시간 낭비하지 마세요.',
    tags: ['AI 추천', '트렌드', '소재 발굴'],
    gradient: 'from-emerald-500 to-teal-500',
    bgGlow: 'bg-emerald-500/10',
  },
  {
    icon: 'description',
    title: '대본 추출 & AI 번역',
    subtitle: '원클릭 자막 추출',
    desc: '유튜브 영상의 자막을 즉시 추출하고, AI가 한국어로 번역하거나 핵심만 요약해줍니다.',
    tags: ['자막 추출', 'AI 번역', '요약'],
    gradient: 'from-amber-500 to-orange-500',
    bgGlow: 'bg-amber-500/10',
  },
  {
    icon: 'schedule',
    title: '업로드 타임 분석',
    subtitle: '최적 시간대 분석',
    desc: '채널별 업로드 패턴을 분석해 조회수가 가장 잘 나오는 요일과 시간대를 알려줍니다.',
    tags: ['시간대 분석', '패턴', '최적화'],
    gradient: 'from-cyan-500 to-blue-500',
    bgGlow: 'bg-cyan-500/10',
  },
  {
    icon: 'travel_explore',
    title: '소스 파인더',
    subtitle: '해외 소스 발굴',
    desc: '해외에서 화제가 되고 있는 영상 소스를 찾아 국내 콘텐츠로 재탄생시킬 기회를 제공합니다.',
    tags: ['해외 소스', '글로벌', '발굴'],
    gradient: 'from-rose-500 to-pink-500',
    bgGlow: 'bg-rose-500/10',
  },
  {
    icon: 'compare',
    title: '채널 비교 분석',
    subtitle: '경쟁 채널 벤치마킹',
    desc: '내 채널과 경쟁 채널의 성과를 한눈에 비교하고, 차별화 전략을 세워보세요.',
    tags: ['비교', '벤치마킹', '인사이트'],
    gradient: 'from-indigo-500 to-purple-500',
    bgGlow: 'bg-indigo-500/10',
  },
];

export const LandingPage = () => {
  const { signInWithGoogle } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const featuresRef = useRef<HTMLDivElement>(null);
  const membershipRef = useRef<HTMLDivElement>(null);
  const loginRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY > 50;
      if (scrolled !== isScrolled) setIsScrolled(scrolled);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isScrolled]);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── 네비게이션 바 ──
  const Nav = () => {
    return (
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${isScrolled ? 'bg-black/80 backdrop-blur-xl border-b border-white/5 shadow-2xl' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center">
            <img src="/logo.png" alt="튜브레이더 Tube Radar 로고" className="h-8 w-auto" />
          </div>
          <div className="flex items-center gap-2 sm:gap-6">
            <button onClick={() => scrollTo(featuresRef)} className="text-slate-400 hover:text-white text-xs sm:text-sm font-bold transition-colors">기능 소개</button>
            <button onClick={() => scrollTo(membershipRef)} className="text-slate-400 hover:text-white text-xs sm:text-sm font-bold transition-colors">멤버십</button>
            <button
              onClick={signInWithGoogle}
              className="bg-white text-black text-xs sm:text-sm font-bold px-4 py-2 rounded-xl hover:bg-slate-200 transition-all hover:scale-105"
            >
              로그인
            </button>
          </div>
        </div>
      </nav>
    );
  };

  // ── 히어로 섹션 ──
  const Hero = () => (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6">
      {/* Animated BG */}
      <div className="absolute inset-0 bg-black">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/80 via-black to-purple-950/60" />
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-600/15 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

      <div className="relative z-10 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-8 backdrop-blur-sm">
          <span className="size-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-xs font-bold text-slate-300 tracking-wide">현재 300+ 크리에이터가 사용 중</span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-7xl font-black text-white leading-[1.1] mb-6 tracking-tight">
          유튜브 채널 분석의
          <br />
          <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">
            올인원 플랫폼
          </span>
        </h1>

        <p className="text-base sm:text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed font-medium">
          트렌드 분석 · 바이럴 탐지 · AI 소재 추천 · 대본 추출
          <br className="hidden sm:block" />
          <span className="text-slate-500">데이터 기반으로 채널 성장을 가속화하세요</span>
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button
            onClick={() => scrollTo(featuresRef)}
            className="group bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold px-8 py-4 rounded-2xl text-base hover:shadow-2xl hover:shadow-indigo-500/30 transition-all hover:scale-105 flex items-center gap-2"
          >
            기능 둘러보기
            <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </button>
          <button
            onClick={signInWithGoogle}
            className="bg-white/5 border border-white/10 text-white font-bold px-8 py-4 rounded-2xl text-base hover:bg-white/10 transition-all backdrop-blur-sm flex items-center gap-2"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="w-5 h-5" />
            Google로 시작하기
          </button>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Scroll</span>
        <span className="material-symbols-outlined text-slate-500 text-lg">keyboard_arrow_down</span>
      </div>
    </section>
  );

  // ── 기능 카드 ──
  const FeatureCard = ({ feature, index }: { feature: typeof FEATURES[0]; index: number }) => {
    const { ref, inView } = useInView(0.15);
    const isEven = index % 2 === 0;

    return (
      <div
        ref={ref}
        className={`flex flex-col ${isEven ? 'md:flex-row' : 'md:flex-row-reverse'} gap-8 md:gap-16 items-center transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}
        style={{ transitionDelay: '100ms' }}
      >
        {/* Text */}
        <div className="flex-1 space-y-5">
          <div className={`inline-flex items-center gap-3 bg-gradient-to-r ${feature.gradient} p-0.5 rounded-2xl`}>
            <div className="bg-black/90 rounded-[14px] px-4 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-white text-lg">{feature.icon}</span>
              <span className="text-xs font-black text-white uppercase tracking-wider">{feature.subtitle}</span>
            </div>
          </div>
          <h3 className="text-2xl sm:text-3xl md:text-4xl font-black text-white leading-tight">{feature.title}</h3>
          <p className="text-slate-400 text-base sm:text-lg leading-relaxed">{feature.desc}</p>
          <div className="flex flex-wrap gap-2">
            {feature.tags.map(tag => (
              <span key={tag} className="text-[11px] font-bold text-slate-500 bg-white/5 border border-white/10 px-3 py-1 rounded-full">{tag}</span>
            ))}
          </div>
        </div>

        {/* Visual Card */}
        <div className="flex-1 w-full max-w-md">
          <div className={`relative rounded-3xl overflow-hidden border border-white/10 ${feature.bgGlow} p-1`}>
            <div className="bg-slate-900/90 rounded-[22px] p-8 sm:p-10 flex flex-col items-center justify-center min-h-[260px] relative overflow-hidden">
              {/* Decorative elements */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-5`} />
              <div className={`absolute -top-8 -right-8 w-32 h-32 bg-gradient-to-br ${feature.gradient} rounded-full blur-[60px] opacity-20`} />

              <span className={`material-symbols-outlined text-6xl sm:text-7xl bg-gradient-to-r ${feature.gradient} bg-clip-text text-transparent mb-4`} style={{ fontVariationSettings: "'FILL' 1" }}>{feature.icon}</span>
              <span className="text-white font-black text-lg sm:text-xl">{feature.title}</span>
              <span className="text-slate-500 text-xs mt-1 font-medium">{feature.subtitle}</span>

              {/* Fake UI elements for visual interest */}
              <div className="absolute bottom-4 left-4 right-4 flex gap-2">
                <div className="h-1.5 bg-white/5 rounded-full flex-[3]" />
                <div className="h-1.5 bg-white/5 rounded-full flex-[2]" />
                <div className="h-1.5 bg-white/5 rounded-full flex-1" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── 통계 섹션 ──
  const Stats = () => {
    const { ref, inView } = useInView();
    return (
      <section ref={ref} className={`py-20 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {[
              { value: 50000, suffix: '+', label: '분석된 영상' },
              { value: 2000, suffix: '+', label: '모니터링 채널' },
              { value: 300, suffix: '+', label: '활성 크리에이터' },
              { value: 98, suffix: '%', label: '사용자 만족도' },
            ].map((stat, i) => (
              <div key={i} className="text-center group">
                <div className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-2">
                  <CountUp end={stat.value} suffix={stat.suffix} />
                </div>
                <div className="text-xs sm:text-sm font-bold text-slate-500 uppercase tracking-wider">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  };

  // ── 이용 단계 ──
  const Steps = () => {
    const { ref, inView } = useInView();
    const steps = [
      { icon: 'subscriptions', title: '유튜브 멤버십 가입', desc: '유튜브 채널 멤버십에 가입하세요' },
      { icon: 'login', title: 'Google 로그인', desc: '멤버십 가입한 구글 계정으로 로그인' },
      { icon: 'rocket_launch', title: '모든 기능 이용', desc: '강력한 분석 도구를 바로 사용하세요' },
    ];
    return (
      <section ref={ref} className={`py-24 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <span className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-4 block">How it works</span>
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-16">
            <span className="text-slate-500">3단계</span>로 시작하세요
          </h2>
          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* Single connecting line behind all icons */}
            <div className="hidden md:block absolute top-12 left-[16.67%] right-[16.67%] h-px bg-white/10 z-0" />
            {steps.map((step, i) => (
              <div key={i} className="relative flex flex-col items-center gap-4">
                <div className="relative z-10 size-24 rounded-3xl bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border border-white/10 flex items-center justify-center mb-2 bg-black">
                  <span className="material-symbols-outlined text-3xl text-white" style={{ fontVariationSettings: "'FILL' 1" }}>{step.icon}</span>
                  <span className="absolute -top-2 -right-2 size-7 bg-indigo-600 rounded-lg text-white text-xs font-black flex items-center justify-center shadow-lg shadow-indigo-500/30">{i + 1}</span>
                </div>
                <h3 className="text-lg font-black text-white">{step.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  };

  // ── 멤버십 비교 ──
  const Membership = () => {
    const { ref, inView } = useInView();
    return (
      <section ref={ref} className={`py-24 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <span className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-4 block">Membership</span>
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">멤버십 등급 안내</h2>
          <p className="text-slate-500 mb-16 text-sm sm:text-base">유튜브 채널 멤버십을 통해 가입할 수 있습니다</p>

          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Silver */}
            <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-8 text-left relative overflow-hidden hover:border-slate-500/30 transition-all group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-slate-500/5 rounded-full blur-[60px]" />
              <div className="flex items-center gap-3 mb-6">
                <div className="size-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-slate-400" style={{ fontVariationSettings: "'FILL' 1" }}>token</span>
                </div>
                <div>
                  <h3 className="text-xl font-black text-white">실버 버튼</h3>
                  <span className="text-xs text-slate-500 font-bold">SILVER BUTTON</span>
                </div>
              </div>
              <ul className="space-y-3 mb-8">
                {['매일 2,000 포인트 지급', '채널 분석 & 모니터링', '대본 추출 & AI 번역', '소재 탐색기 이용', '1:1 문의 지원'].map(f => (
                  <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                    <span className="material-symbols-outlined text-sm text-slate-600">check_circle</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => window.open('https://www.youtube.com/channel/UClP2hW295JL_o-lESiMY0fg/join', '_blank')}
                className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-sm hover:bg-white/10 transition-all"
              >
                가입하기
              </button>
            </div>

            {/* Gold */}
            <div className="bg-slate-900/80 border border-amber-500/30 rounded-3xl p-8 text-left relative overflow-hidden hover:border-amber-500/50 transition-all group shadow-lg shadow-amber-500/5">
              <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/10 rounded-full blur-[80px]" />
              <div className="absolute top-4 right-4">
                <span className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider shadow-lg shadow-amber-500/30">Best</span>
              </div>
              <div className="flex items-center gap-3 mb-6">
                <div className="size-12 rounded-2xl bg-amber-900/30 border border-amber-700/50 flex items-center justify-center">
                  <span className="material-symbols-outlined text-amber-400" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                </div>
                <div>
                  <h3 className="text-xl font-black text-white">골드 버튼</h3>
                  <span className="text-xs text-amber-500 font-bold">GOLD BUTTON</span>
                </div>
              </div>
              <ul className="space-y-3 mb-8">
                {['매일 5,000 포인트 지급', '실버 버튼 모든 기능 포함', '시크릿 추천 소재', '추천 채널 팩', '유튜브 대본 추출 & AI 번역', '유사 썸네일 찾기', '우선 고객 지원'].map(f => (
                  <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                    <span className="material-symbols-outlined text-sm text-amber-500">check_circle</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => window.open('https://www.youtube.com/channel/UClP2hW295JL_o-lESiMY0fg/join', '_blank')}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm hover:shadow-xl hover:shadow-amber-500/20 transition-all hover:scale-[1.02]"
              >
                가입하기
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  };

  // ── 최종 CTA ──
  const FinalCTA = () => {
    const { ref, inView } = useInView();
    return (
      <section ref={ref} className={`py-24 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="relative bg-gradient-to-br from-indigo-950/80 to-purple-950/80 border border-white/10 rounded-[2rem] p-10 sm:p-16 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 to-purple-600/10" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-indigo-500/10 rounded-full blur-[100px]" />

            <div className="relative z-10">
              <span className="material-symbols-outlined text-5xl text-indigo-400 mb-6 block" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-4 leading-tight">
                지금 바로 시작하세요
              </h2>
              <p className="text-slate-400 mb-10 text-sm sm:text-base leading-relaxed">
                이미 멤버십 회원이신가요?<br />
                구글 계정으로 로그인하면 모든 기능을 바로 사용할 수 있습니다.
              </p>
              <button
                onClick={signInWithGoogle}
                className="inline-flex items-center gap-3 bg-white text-black font-bold px-8 py-4 rounded-2xl text-base hover:bg-slate-100 transition-all hover:scale-105 shadow-2xl shadow-white/10"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="w-5 h-5" />
                Google 계정으로 시작하기
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  };

  // ── 풋터 ──
  const LandingFooter = () => (
    <footer className="py-8 border-t border-white/5">
      <div className="max-w-5xl mx-auto px-6 text-center space-y-4">
        <div className="flex justify-center items-center gap-4 text-[11px] font-bold text-slate-600">
          <span>Copyright © 2025 admaker. All Rights Reserved.</span>
        </div>
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-slate-700">
          <span>상호명: admaker</span>
          <span className="text-slate-800">|</span>
          <span>대표자: 현승효</span>
          <span className="text-slate-800">|</span>
          <span>사업자번호: 591-37-00365</span>
          <span className="text-slate-800">|</span>
          <span>EMAIL: boxtvstar@gmail.com</span>
        </div>
      </div>
    </footer>
  );

  // ── 메인 렌더 ──
  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <Nav />
      <Hero />

      {/* Features */}
      <section ref={featuresRef} className="py-24 relative">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20">
            <span className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-4 block">Features</span>
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
              크리에이터를 위한 <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">올인원 도구</span>
            </h2>
            <p className="text-slate-500 text-sm sm:text-base max-w-lg mx-auto">데이터 분석부터 AI 기반 추천까지, 채널 성장에 필요한 모든 것</p>
          </div>
          <div className="space-y-24 sm:space-y-32">
            {FEATURES.map((feature, i) => (
              <FeatureCard key={i} feature={feature} index={i} />
            ))}
          </div>
        </div>
      </section>

      <Stats />
      <Steps />
      <div ref={membershipRef}>
        <Membership />
      </div>
      <div ref={loginRef}>
        <FinalCTA />
      </div>
      <LandingFooter />
    </div>
  );
};

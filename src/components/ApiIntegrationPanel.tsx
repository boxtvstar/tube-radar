import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../lib/firebase';

interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
  todayCalls: number;
  dailyLimit: number;
}

interface Props {
  isAllowed: boolean;
}

type GuideTab = 'claude-code' | 'claude-ai' | 'codex' | 'cursor' | 'rest';

const GUIDES: { id: GuideTab; label: string; icon: string }[] = [
  { id: 'claude-code', label: 'Claude Code', icon: 'terminal' },
  { id: 'claude-ai', label: 'Claude.ai / Desktop', icon: 'chat' },
  { id: 'codex', label: 'Codex', icon: 'code' },
  { id: 'cursor', label: 'Cursor', icon: 'edit_note' },
  { id: 'rest', label: 'REST API', icon: 'http' },
];

const EXAMPLE_PROMPTS = [
  '오늘 뜨는 쇼츠 찾아줘',
  '미국에서 지금 터지는 쇼츠 채널 10개 보여줘',
  '커뮤니티 핫게시글 중 클리앙 것만 요약해줘',
  '이번 주 새로 발굴된 급성장 채널 알려줘',
];

const getIdToken = async () => {
  const u = auth.currentUser;
  if (!u) throw new Error('로그인이 필요합니다');
  return u.getIdToken();
};

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* noop */ }
      }}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all whitespace-nowrap"
    >
      <span className="material-symbols-outlined text-[14px]">{done ? 'check' : 'content_copy'}</span>
      {done ? '복사됨' : (label || '복사')}
    </button>
  );
};

const CodeBlock: React.FC<{ code: string }> = ({ code }) => (
  <div className="relative group">
    <pre className="bg-slate-900 text-slate-100 text-[12px] leading-relaxed rounded-xl p-4 overflow-x-auto font-mono whitespace-pre-wrap break-all">{code}</pre>
    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"><CopyButton text={code} /></div>
  </div>
);

export const ApiIntegrationPanel: React.FC<Props> = ({ isAllowed }) => {
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [guide, setGuide] = useState<GuideTab>('claude-code');

  const origin = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : 'https://www.tuberadar.kr'), []);
  const keyForSnippet = issuedKey || '<발급받은_키>';

  const load = useCallback(async () => {
    if (!isAllowed) return;
    setLoading(true); setError('');
    try {
      const token = await getIdToken();
      const r = await fetch(`/api/keys?idToken=${encodeURIComponent(token)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || '목록을 불러오지 못했습니다');
      setKeys(d.keys || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [isAllowed]);

  useEffect(() => { load(); }, [load]);

  const issue = async () => {
    setIssuing(true); setError('');
    try {
      const token = await getIdToken();
      const r = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token, name: newKeyName }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || '발급에 실패했습니다');
      setIssuedKey(d.key);
      setNewKeyName('');
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setIssuing(false); }
  };

  const revoke = async (k: ApiKeyView) => {
    if (!window.confirm(`"${k.name}" 키를 폐기할까요? 이 키로 연결된 Claude/Codex/Cursor는 즉시 동작을 멈춥니다.`)) return;
    setError('');
    try {
      const token = await getIdToken();
      const r = await fetch('/api/keys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token, keyId: k.id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || '폐기에 실패했습니다');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const snippets: Record<GuideTab, { title: string; steps: string[]; code: string }> = {
    'claude-code': {
      title: 'Claude Code (터미널)',
      steps: ['터미널에 아래 명령을 한 번 실행하면 등록됩니다.', '이후 Claude Code에서 "오늘 뜨는 쇼츠 찾아줘"라고 말하면 됩니다.'],
      code: `claude mcp add --transport http tuberadar ${origin}/api/mcp --header "Authorization: Bearer ${keyForSnippet}"`,
    },
    'claude-ai': {
      title: 'Claude.ai 웹 / Claude Desktop (커스텀 커넥터)',
      steps: ['설정 → 커넥터 → "커스텀 커넥터 추가"를 누릅니다.', '이름은 TubeRadar, URL에는 아래 주소를 그대로 붙여넣습니다 (키가 주소에 포함되어 별도 인증은 필요 없습니다).', '대화에서 TubeRadar 커넥터를 켜고 질문하면 됩니다.'],
      code: `${origin}/api/mcp/${keyForSnippet}`,
    },
    'codex': {
      title: 'Codex CLI',
      steps: ['~/.codex/config.toml 파일에 아래 내용을 추가합니다.', 'Codex를 다시 실행하면 tuberadar 도구가 보입니다.'],
      code: `[mcp_servers.tuberadar]\nurl = "${origin}/api/mcp/${keyForSnippet}"`,
    },
    'cursor': {
      title: 'Cursor',
      steps: ['프로젝트의 .cursor/mcp.json (또는 전역 ~/.cursor/mcp.json)에 추가합니다.', 'Cursor 설정 → MCP 에서 tuberadar가 켜져 있는지 확인합니다.'],
      code: `{\n  "mcpServers": {\n    "tuberadar": { "url": "${origin}/api/mcp/${keyForSnippet}" }\n  }\n}`,
    },
    'rest': {
      title: 'REST API (직접 호출)',
      steps: ['MCP 없이도 아래처럼 바로 호출할 수 있습니다. 응답은 JSON입니다.', '사용 가능 경로: /api/v1/shorts?region=KR&deep=false · /api/v1/hot-posts?source=클리앙 · /api/v1/rising-channels'],
      code: `curl -H "Authorization: Bearer ${keyForSnippet}" "${origin}/api/v1/shorts?region=KR&limit=10"`,
    },
  };

  if (!isAllowed) {
    return (
      <div className="rounded-3xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-8 text-center space-y-3">
        <span className="material-symbols-outlined text-5xl text-amber-500">lock</span>
        <h3 className="text-lg font-black text-slate-900 dark:text-white">API 연동은 골드 등급 전용입니다</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">골드 이상 회원은 API 키를 발급해 Claude·Codex·Cursor에서 튜브레이더 기능을 바로 쓸 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      {/* 소개 */}
      <div className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-3xl p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined">api</span>
          <h3 className="text-lg font-black">내 AI에 튜브레이더 연결하기</h3>
        </div>
        <p className="text-sm text-white/85 leading-relaxed">
          API 키 하나로 이미 쓰고 있는 Claude · Codex · Cursor 에 튜브레이더 도구를 붙입니다. 추가 요금 없이 본인 구독으로 동작합니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map(p => (
            <span key={p} className="text-[11px] font-bold bg-white/15 border border-white/25 rounded-full px-3 py-1">"{p}"</span>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-600 dark:text-rose-300 font-bold">{error}</div>
      )}

      {/* 새 키 발급 결과 (1회 노출) */}
      {issuedKey && (
        <div className="rounded-2xl border-2 border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-black">
            <span className="material-symbols-outlined">key</span> 새 API 키가 발급되었습니다
          </div>
          <p className="text-xs text-emerald-800 dark:text-emerald-200 font-bold">⚠️ 이 키는 지금 한 번만 표시됩니다. 지금 복사해서 안전한 곳에 보관하세요. 창을 닫으면 다시 볼 수 없습니다.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-[12px] font-mono break-all">{issuedKey}</code>
            <CopyButton text={issuedKey} label="키 복사" />
          </div>
          <p className="text-[11px] text-slate-500">아래 연결 안내의 명령·주소에는 이 키가 자동으로 채워져 있습니다.</p>
        </div>
      )}

      {/* 발급 */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-black text-slate-900 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-indigo-500">vpn_key</span> API 키</h4>
          <span className="text-[11px] text-slate-400 font-bold">키당 하루 도구 호출 {keys[0]?.dailyLimit ?? 100}회 · 활성 키 최대 5개</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !issuing) issue(); }}
            placeholder="키 이름 (예: 맥북 Claude Code)"
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={issue}
            disabled={issuing}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold transition-all whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">{issuing ? 'hourglass_top' : 'add'}</span>
            {issuing ? '발급 중…' : '새 키 발급'}
          </button>
        </div>

        {/* 목록 */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-6 text-center text-sm text-slate-400">불러오는 중…</div>
          ) : keys.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">아직 발급된 키가 없습니다. 위에서 첫 키를 만들어보세요.</div>
          ) : keys.map(k => (
            <div key={k.id} className={`flex items-center gap-3 px-4 py-3 ${k.revoked ? 'opacity-50' : ''}`}>
              <span className="material-symbols-outlined text-slate-400">{k.revoked ? 'key_off' : 'key'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800 dark:text-white truncate">{k.name}</span>
                  <code className="text-[11px] font-mono text-slate-500">{k.prefix}</code>
                  {k.revoked && <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500">폐기됨</span>}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  생성 {k.createdAt ? new Date(k.createdAt).toLocaleDateString('ko-KR') : '-'}
                  {' · '}마지막 사용 {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('ko-KR') : '없음'}
                  {' · '}오늘 {k.todayCalls}/{k.dailyLimit}회
                </div>
              </div>
              {!k.revoked && (
                <button type="button" onClick={() => revoke(k)} className="text-[11px] font-bold text-rose-500 hover:text-rose-600 px-2 py-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all">폐기</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 연결 안내 */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-4">
        <h4 className="font-black text-slate-900 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-indigo-500">cable</span> 연결 방법</h4>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {GUIDES.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGuide(g.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-all ${guide === g.id ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30' : 'text-slate-500 border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <span className="material-symbols-outlined text-[16px]">{g.icon}</span>{g.label}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{snippets[guide].title}</p>
          <ol className="list-decimal pl-5 space-y-1 text-[13px] text-slate-600 dark:text-slate-300">
            {snippets[guide].steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <CodeBlock code={snippets[guide].code} />
          {!issuedKey && <p className="text-[11px] text-slate-400">위 코드의 <code className="font-mono">&lt;발급받은_키&gt;</code> 자리에 본인 키를 넣으세요. 새 키를 발급하면 자동으로 채워집니다.</p>}
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 text-[12px] text-slate-600 dark:text-slate-300 space-y-1">
          <p className="font-bold text-slate-700 dark:text-slate-200">제공 도구 3가지</p>
          <p>• <b>get_trending_shorts</b> — 오늘 뜨는 쇼츠 채널 (국가별, 구독자 대비 조회수 순)</p>
          <p>• <b>get_community_hot_posts</b> — 커뮤니티 12곳 실시간 핫게시글</p>
          <p>• <b>get_rising_channels</b> — 신규 급성장 채널 (매일 갱신)</p>
          <p className="pt-1 text-slate-400">키가 유출됐다고 생각되면 위 목록에서 즉시 폐기하고 새로 발급하세요.</p>
        </div>
      </div>
    </div>
  );
};

export default ApiIntegrationPanel;

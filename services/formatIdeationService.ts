export interface BenchmarkVideoInsight {
  summary: string;
  coreTopic: string;
  audienceTargets: string[];
  hookPatterns: string[];
  structurePatterns: string[];
  titleAngles: string[];
  toneGuide: string[];
  differentiators: string[];
  estimatedDurationMinutes: number;
  durationGuide: string;
}

export interface BenchmarkVideoInput {
  url: string;
  title: string;
  channel?: string;
  durationText?: string;
}

export interface TopicIdea {
  id: string;
  topic: string;
  title: string;
  summary: string;
  whyThisFits: string;
}

export interface ScriptGenerationResult {
  title: string;
  targetDurationGuide: string;
  openingHook: string;
  summary: string;
  sectionOutline: string[];
  fullScript: string;
  closingCta: string;
}

const stripCodeFence = (value: string) =>
  value.replace(/```json/gi, '').replace(/```/g, '').trim();

const extractJson = <T>(raw: string): T => JSON.parse(stripCodeFence(raw)) as T;

const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash';

const toRestPart = (part: Record<string, unknown>) => {
  if ('fileData' in part) {
    const fileData = part.fileData as Record<string, unknown>;
    return {
      file_data: {
        file_uri: fileData.fileUri,
        ...(fileData.mimeType ? { mime_type: fileData.mimeType } : {}),
      },
    };
  }

  if ('inlineData' in part) {
    const inlineData = part.inlineData as Record<string, unknown>;
    return {
      inline_data: {
        mime_type: inlineData.mimeType,
        data: inlineData.data,
      },
    };
  }

  return part;
};

const getGeminiErrorMessage = (status: number, errorText: string) => {
  const parsed = (() => {
    try {
      return JSON.parse(errorText);
    } catch {
      return null;
    }
  })();

  const apiMessage = String(parsed?.error?.message || '').trim();
  const apiReason = String(
    parsed?.error?.details?.find?.((detail: any) => detail?.reason)?.reason ||
    parsed?.error?.status ||
    ''
  ).trim();

  if (status === 429) {
    return 'Gemini API 오류 (429): 요청이 너무 많거나 API 키 쿼터가 초과되었습니다. 잠시 후 다시 시도하거나 Gemini 요금제/쿼터를 확인해주세요.';
  }

  if (status === 400) {
    if (apiMessage.includes('public videos')) {
      return 'Gemini API 오류 (400): 공개(Public) 상태의 YouTube 영상만 분석할 수 있습니다. 비공개/일부공개 영상은 지원되지 않습니다.';
    }

    return 'Gemini API 오류 (400): Gemini가 이 YouTube 영상을 처리하지 못했습니다. 공개 영상인지 확인하고, 잠시 후 다시 시도해주세요.';
  }

  if (status === 403) {
    if (apiMessage.toLowerCase().includes('blocked')) {
      return `Gemini API 오류 (403): 현재 등록된 Gemini API 키는 GenerateContent 호출이 차단되어 있습니다. Google AI Studio에서 새 키를 발급받아 다시 등록하거나, API 키 제한 설정을 확인해주세요.${apiReason ? ` (${apiReason})` : ''}`;
    }

    return `Gemini API 오류 (403): 현재 등록된 Gemini API 키에 Gemini 호출 권한이 없거나 제한 설정이 잘못되었습니다. Google AI Studio에서 키 제한, API 사용 설정, 현재 도메인 허용 여부를 확인해주세요.${apiMessage ? `\n상세: ${apiMessage}` : ''}`;
  }

  return `Gemini API 오류 (${status})${apiMessage ? `: ${apiMessage}` : ''}`;
};

const normalizeYouTubeUrl = (url: string) => {
  const value = url.trim();
  const watchId = value.match(/[?&]v=([^&#]+)/)?.[1];
  const shortId = value.match(/youtu\.be\/([^?&#/]+)/)?.[1];
  const shortsId = value.match(/shorts\/([^?&#/]+)/)?.[1];
  const embedId = value.match(/embed\/([^?&#/]+)/)?.[1];
  const videoId = watchId || shortId || shortsId || embedId;

  if (!videoId) return value;
  return `https://www.youtube.com/watch?v=${videoId}`;
};

const postToGemini = async (
  apiKey: string,
  parts: Array<Record<string, unknown>>,
  model = DEFAULT_TEXT_MODEL
) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: parts.map(toRestPart) }],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Format ideation Gemini error:', errorText);
    throw new Error(getGeminiErrorMessage(response.status, errorText));
  }

  const data = await response.json();
  const text = stripCodeFence(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');

  if (!text) {
    throw new Error('Gemini 응답이 비어있습니다.');
  }

  return text;
};

export const analyzeBenchmarkVideo = async (
  apiKey: string,
  video: BenchmarkVideoInput
): Promise<BenchmarkVideoInsight> => {
  const normalizedUrl = normalizeYouTubeUrl(video.url);
  const prompt = `
당신은 유튜브 기획 포맷 분석가다.
전달된 YouTube URL 영상을 직접 보고, 문장 복제가 아니라 기획 구조와 형식만 분석해야 한다.

[분석 대상]
- 제목: ${video.title}
- 채널: ${video.channel || '알 수 없음'}
- 길이 참고: ${video.durationText || '길이 정보 없음'}

[해야 할 일]
1. 영상의 핵심 주제를 1문장으로 정리한다.
2. 핵심 요약을 2~3문장으로 작성한다.
3. 시청자 타겟, 훅 패턴, 전개 구조, 제목 각도, 톤을 정리한다.
4. 이 영상의 차별 포인트를 정리한다.
5. 영상의 길이감을 추정하거나 참고 길이를 바탕으로 적절한 러닝타임 가이드를 만든다.

[중요]
- 원문 문장, 비유, 표현을 옮겨 적지 말 것
- 포맷과 구성만 추출할 것
- 한국어로 작성할 것
- 반드시 JSON만 출력할 것

[JSON 스키마]
{
  "summary": "string",
  "coreTopic": "string",
  "audienceTargets": ["string"],
  "hookPatterns": ["string"],
  "structurePatterns": ["string"],
  "titleAngles": ["string"],
  "toneGuide": ["string"],
  "differentiators": ["string"],
  "estimatedDurationMinutes": 0,
  "durationGuide": "string"
}
  `.trim();

  const raw = await postToGemini(apiKey, [
    { fileData: { fileUri: normalizedUrl } },
    { text: prompt },
  ], DEFAULT_TEXT_MODEL);
  const parsed = extractJson<Partial<BenchmarkVideoInsight>>(raw);

  return {
    summary: parsed.summary || '영상 요약을 생성하지 못했습니다.',
    coreTopic: parsed.coreTopic || '핵심 주제를 생성하지 못했습니다.',
    audienceTargets: Array.isArray(parsed.audienceTargets) ? parsed.audienceTargets.slice(0, 4) : [],
    hookPatterns: Array.isArray(parsed.hookPatterns) ? parsed.hookPatterns.slice(0, 4) : [],
    structurePatterns: Array.isArray(parsed.structurePatterns) ? parsed.structurePatterns.slice(0, 5) : [],
    titleAngles: Array.isArray(parsed.titleAngles) ? parsed.titleAngles.slice(0, 4) : [],
    toneGuide: Array.isArray(parsed.toneGuide) ? parsed.toneGuide.slice(0, 4) : [],
    differentiators: Array.isArray(parsed.differentiators) ? parsed.differentiators.slice(0, 4) : [],
    estimatedDurationMinutes:
      typeof parsed.estimatedDurationMinutes === 'number' && Number.isFinite(parsed.estimatedDurationMinutes)
        ? Math.max(1, Math.round(parsed.estimatedDurationMinutes))
        : 8,
    durationGuide: parsed.durationGuide || video.durationText || '약 8분 분량',
  };
};

export const generateBenchmarkTopics = async (
  apiKey: string,
  benchmark: BenchmarkVideoInput & { insight: BenchmarkVideoInsight },
  count = 10
): Promise<TopicIdea[]> => {
  const safeCount = Math.min(Math.max(count, 5), 10);
  const prompt = `
당신은 유튜브 기획자다.
아래 벤치마크 영상의 문장을 베끼지 말고, 형식과 몰입 구조만 참고해서 새로운 주제를 만들어야 한다.

[벤치마크 영상]
- 제목: ${benchmark.title}
- 채널: ${benchmark.channel || '알 수 없음'}
- 핵심 주제: ${benchmark.insight.coreTopic}
- 요약: ${benchmark.insight.summary}
- 타겟 시청자: ${benchmark.insight.audienceTargets.join(' | ') || '없음'}
- 훅 패턴: ${benchmark.insight.hookPatterns.join(' | ') || '없음'}
- 전개 구조: ${benchmark.insight.structurePatterns.join(' | ') || '없음'}
- 제목 각도: ${benchmark.insight.titleAngles.join(' | ') || '없음'}
- 톤: ${benchmark.insight.toneGuide.join(' | ') || '없음'}
- 차별 포인트: ${benchmark.insight.differentiators.join(' | ') || '없음'}
- 길이감: ${benchmark.insight.durationGuide}

[해야 할 일]
1. 같은 시청자가 클릭할 만한 새로운 주제를 ${safeCount}개 만든다.
2. 각 주제마다 제목, 간략 설명, 이 포맷과 맞는 이유를 작성한다.
3. 설명은 2~4문장으로 짧고 명확하게 쓴다.
4. 기존 영상과 주제는 달라야 하지만, 훅 방식과 전개 리듬은 유지한다.

[중요]
- 원문 표현을 재사용하지 말 것
- 과장된 만능 조언 금지
- 한국어
- 반드시 JSON만 출력

[JSON 스키마]
{
  "topics": [
    {
      "id": "string",
      "topic": "string",
      "title": "string",
      "summary": "string",
      "whyThisFits": "string"
    }
  ]
}
  `.trim();

  const raw = await postToGemini(apiKey, [{ text: prompt }]);
  const parsed = extractJson<{ topics?: Array<Partial<TopicIdea>> }>(raw);

  return Array.isArray(parsed.topics)
    ? parsed.topics.slice(0, safeCount).map((topic, index) => ({
        id: topic.id || `topic_${index + 1}`,
        topic: topic.topic || `새 주제 ${index + 1}`,
        title: topic.title || '제목 미생성',
        summary: topic.summary || '설명을 생성하지 못했습니다.',
        whyThisFits: topic.whyThisFits || '이유를 생성하지 못했습니다.',
      }))
    : [];
};

export const generateBenchmarkScript = async (
  apiKey: string,
  benchmark: BenchmarkVideoInput & { insight: BenchmarkVideoInsight },
  idea: TopicIdea
): Promise<ScriptGenerationResult> => {
  const prompt = `
당신은 유튜브 대본 기획자다.
벤치마크 영상의 문장을 복제하지 않고, 형식과 길이감만 참고해서 완전히 새로운 대본을 작성해야 한다.

[벤치마크]
- 제목: ${benchmark.title}
- 채널: ${benchmark.channel || '알 수 없음'}
- 핵심 주제: ${benchmark.insight.coreTopic}
- 요약: ${benchmark.insight.summary}
- 훅 패턴: ${benchmark.insight.hookPatterns.join(' | ') || '없음'}
- 전개 구조: ${benchmark.insight.structurePatterns.join(' | ') || '없음'}
- 제목 각도: ${benchmark.insight.titleAngles.join(' | ') || '없음'}
- 톤: ${benchmark.insight.toneGuide.join(' | ') || '없음'}
- 길이감: ${benchmark.insight.durationGuide}

[새로 만들 주제]
- 주제: ${idea.topic}
- 제목: ${idea.title}
- 설명: ${idea.summary}
- 적합 이유: ${idea.whyThisFits}

[해야 할 일]
1. 벤치마크 영상과 비슷한 분량감으로 새로운 대본을 작성한다.
2. 도입 훅, 본문 흐름, 마무리 CTA까지 포함한다.
3. 각 문단은 바로 영상 대본으로 읽을 수 있게 자연스럽게 쓴다.
4. 원문 표현, 비유, 문장 구조를 재사용하지 않는다.

[출력 규칙]
- 한국어
- 반드시 JSON만 출력
- fullScript는 실제 낭독 가능한 긴 문자열

[JSON 스키마]
{
  "title": "string",
  "targetDurationGuide": "string",
  "openingHook": "string",
  "summary": "string",
  "sectionOutline": ["string"],
  "fullScript": "string",
  "closingCta": "string"
}
  `.trim();

  const raw = await postToGemini(apiKey, [{ text: prompt }]);
  const parsed = extractJson<Partial<ScriptGenerationResult>>(raw);

  return {
    title: parsed.title || idea.title,
    targetDurationGuide: parsed.targetDurationGuide || benchmark.insight.durationGuide,
    openingHook: parsed.openingHook || '도입 훅을 생성하지 못했습니다.',
    summary: parsed.summary || '대본 요약을 생성하지 못했습니다.',
    sectionOutline: Array.isArray(parsed.sectionOutline) ? parsed.sectionOutline : [],
    fullScript: parsed.fullScript || '대본 본문을 생성하지 못했습니다.',
    closingCta: parsed.closingCta || '마무리 CTA를 생성하지 못했습니다.',
  };
};

/**
 * Google Gemini API를 사용하여 채널 추천 이유를 생성합니다.
 * 라이브러리 의존성 없이 fetch API를 직접 사용합니다.
 */
export const generateChannelRecommendation = async (
  apiKey: string,
  channelName: string,
  channelDesc: string,
  videoTitles: string[]
): Promise<string> => {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const promptText = `
      당신은 유튜브 채널 분석 전문가입니다.
      다음 채널 정보를 바탕으로, 이 채널을 "유튜브 소재"로 추천하는 이유를 2~3문장으로 매력적이고 통찰력 있게 요약해서 작성해주세요.
      문체는 "~함", "~임" 등의 간결한 명사형 종결어미를 사용하거나, 전문적인 어조를 사용하세요.

      채널명: ${channelName}
      채널 설명: ${channelDesc.substring(0, 300)}
      최근 주요 영상:
      ${videoTitles.slice(0, 5).map(t => "- " + t).join("\n")}

      추천 이유:
    `;

    const payload = {
      contents: [{
        parts: [{ text: promptText }]
      }]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error("Gemini API Error details:", errText);
        throw new Error(`Gemini API Error: ${response.status}`);
    }

    const data = await response.json();
    
    // 응답 파싱
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
        return data.candidates[0].content.parts[0].text.trim();
    }
    
    return "AI 분석 결과가 비어있습니다.";

  } catch (error) {
    console.error("Gemini 호출 실패:", error);
    throw error;
  }
};

export interface AnalysisResponse {
  viralReason: string;
  engagementQuality: string;
  topicTrend: string;
}

/**
 * 비디오 데이터를 분석하여 바이럴 요인을 도출합니다.
 */
export const analyzeVideoVirality = async (video: any, apiKey: string): Promise<AnalysisResponse> => {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const promptText = `
      당신은 유튜브 알고리즘 분석 AI입니다. 다음 비디오 데이터를 분석하여 왜 이 영상이 반응을 얻고 있는지(또는 얻을 것인지) 분석해주세요.
      
      [비디오 정보]
      제목: ${video.title}
      채널: ${video.channelName}
      조회수: ${video.views} (평균 조회수: ${video.avgViews})
      구독자 대비 조회수 비율(Viral Score): ${video.viralScore}
      업로드: ${video.uploadTime}
      
      [분석 요청]
      다음 3가지 항목을 JSON 형식으로 답변해주세요.
      1. viralReason: 왜 이 영상이 터졌는지(핵심 소구점) 한 줄 요약 (반말, 명사형 종결)
      2. engagementQuality: 시청자 참여도나 반응 예상 (높음/보통/낮음 및 이유)
      3. topicTrend: 이 주제가 현재 유튜브에서 어떤 트렌드 위치에 있는지

      응답 예시:
      {
        "viralReason": "초반 3초 후킹이 강력하고 반전 요소가 있음",
        "engagementQuality": "높음 - 논쟁적인 주제로 댓글 참여 활발 예상",
        "topicTrend": "상승세 - 최근 '먹방' 키워드와 결합되어 유행 중"
      }
      
      반드시 JSON 포맷만 출력하세요. 마크다운 코드블럭 없이 순수 JSON 문자열만 주세요.
    `;

    const payload = {
      contents: [{
        parts: [{ text: promptText }]
      }]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);

    const data = await response.json();
    let text = "{}";
    
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
        text = data.candidates[0].content.parts[0].text;
        // 마크다운 제거 (```json ... ```)
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    
    try {
        const result = JSON.parse(text);
        return {
            viralReason: result.viralReason || "분석 불가",
            engagementQuality: result.engagementQuality || "정보 없음",
            topicTrend: result.topicTrend || "확인 필요"
        };
    } catch (e) {
        console.error("JSON Parse Error", e, text);
        return {
            viralReason: "AI 응답 파싱 실패",
            engagementQuality: "-",
            topicTrend: "-"
        };
    }

  } catch (error) {
    console.error("Video Analysis Failed:", error);
    throw error;
  }
};

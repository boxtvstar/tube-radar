
import { GoogleGenAI, Type } from "@google/genai";
import { VideoData, AnalysisResponse } from "../types";

// 로컬 캐시 키 정의
const CACHE_KEY_PREFIX = "viral_analysis_cache_";

export const analyzeVideoVirality = async (video: VideoData, apiKey: string): Promise<AnalysisResponse> => {
  // 1. 캐시 확인 (API 사용 최소화)
  const cachedData = localStorage.getItem(CACHE_KEY_PREFIX + video.id);
  if (cachedData) {
    console.log("캐시된 분석 결과를 반환합니다.");
    return JSON.parse(cachedData);
  }

  // 2. 새로운 인스턴스 생성
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `당신은 유튜브 알고리즘 전문가입니다. 다음 영상이 왜 바이럴(급상승) 되었는지 한국어로 분석해 주세요:
  제목: ${video.title}
  채널명: ${video.channelName}
  현재 조회수: ${video.views} (평균 대비: ${video.viralScore})
  카테고리: ${video.category}
  
  다음 세 가지 항목에 대해 한국어로 상세히 답변해 주세요:
  1. viralReason: 바이럴이 발생한 구체적인 원인 (호기심 유발 요소, 썸네일 전략 등)
  2. engagementQuality: 시청자 반응 및 댓글 감성 분석 예상
  3. topicTrend: 현재 시장에서의 주제 관련성 및 트렌드 가치
  
  반드시 JSON 형식으로 답변해야 합니다.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            viralReason: { type: Type.STRING, description: "바이럴 원인 분석" },
            engagementQuality: { type: Type.STRING, description: "참여도 품질 분석" },
            topicTrend: { type: Type.STRING, description: "주제 트렌드 분석" },
          },
          required: ["viralReason", "engagementQuality", "topicTrend"],
        },
      },
    });

    const result = JSON.parse(response.text || '{}') as AnalysisResponse;
    
    // 3. 결과 캐싱 (다음 호출 방지)
    localStorage.setItem(CACHE_KEY_PREFIX + video.id, JSON.stringify(result));
    
    return result;
  } catch (error: any) {
    console.error("Gemini analysis failed:", error);
    
    // API 키 관련 오류일 경우를 대비한 처리 (UI에서 재설정 유도)
    if (error.message?.includes("Requested entity was not found")) {
      throw new Error("API_KEY_ERROR");
    }

    return {
      viralReason: "분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      engagementQuality: "데이터를 불러올 수 없습니다.",
      topicTrend: "알 수 없음"
    };
  }
};

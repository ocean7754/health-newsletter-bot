// generate.js
//
// 동작 순서
// 1. content-history.json에서 최근 생성 이력 읽기
// 2. Claude API로 중복되지 않는 건강 게시글 생성
// 3. 생성 결과를 Gmail로 발송
// 4. 생성 결과의 주제 지문을 추출해 content-history.json에 저장
//
// 필요한 환경변수:
// ANTHROPIC_API_KEY
// GMAIL_USER
// GMAIL_APP_PASSWORD
// MAIL_TO

import nodemailer from "nodemailer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------
// 기본 설정
// ---------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, "content-history.json");

// 최근 며칠치 이력을 프롬프트에 넣을지
const HISTORY_DAYS = 14;

// 프롬프트에 넣을 이전 게시글 최대 개수
const MAX_HISTORY_ITEMS = 120;

// JSON 파일에 장기 보관할 최대 개수
const MAX_STORED_ITEMS = 300;

const MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------
// 시스템 프롬프트
// ---------------------------------------------------------------

const SYSTEM_PROMPT = `
너는 네이버 건강 카페에 올릴 게시글 초안을 작성한다.

글은 30~40대 여성이 자신의 생활 속 건강 고민을 편하게 이야기하는 말투로 쓴다.
의학 정보를 설명하는 블로그 글보다 실제 경험과 고민을 나누는 카페 글에 가깝게 작성한다.

작성 규칙:
- 요청한 개수만큼 제목과 본문을 작성한다.
- 본문은 7~10문장 내외로 작성한다.
- 생활 속 구체적인 장면, 감정, 고민을 자연스럽게 포함한다.
- ㅋㅋ, ㅎㅎ, ㅠㅠ, 혼잣말은 일부 글에만 사용한다.
- 글마다 말투, 문장 길이, 문단 수, 시작과 마무리를 다르게 한다.
- 마지막을 모두 같은 질문 문장으로 끝내지 않는다.
- 전문적인 진단이나 단정적인 치료 조언은 하지 않는다.

반복 방지:
- 제공된 최근 생성 이력과 비슷한 글을 만들지 않는다.
- 제목만 다르고 핵심 소재가 같은 경우도 반복으로 본다.
- 다음 중 2개 이상이 이전 글과 비슷하면 다른 소재로 교체한다.
  1. 핵심 주제
  2. 증상 또는 신체 부위
  3. 문제가 시작된 계기
  4. 본인이 시도한 행동
  5. 걱정하는 내용
  6. 이야기의 결말

유사 주제도 같은 주제로 취급한다.
예:
- 손발 냉증, 손 시림, 수족냉증
- 손 부종, 아침 붓기, 손가락 뻣뻣함
- 건강검진 충격, 검사 수치 걱정, 검진 결과 고민
- 만성피로, 아침 피로, 자도 피곤함
- 소화불량, 더부룩함, 위장 불편

한 번의 출력에서는 서로 다른 건강 영역을 사용한다.
같은 신체 부위나 같은 원인 추측을 반복하지 않는다.

글의 전개도 다양하게 한다:
- 일상 속 불편한 장면으로 시작
- 주변 사람의 말을 듣고 신경 쓰이기 시작
- 좋다고 시작한 습관이 오히려 불편해짐
- 예전과 달라진 점을 뒤늦게 발견
- 병원에 갈지 말지 고민
- 관리 후 예상 밖의 변화가 생김
- 두 가지 방법 중 무엇을 선택할지 고민
- 가족이나 직장 생활 때문에 관리가 어려운 상황

금지:
- 정보 나열
- 교과서식 설명
- 모든 글에 같은 이야기 순서 적용
- "꾸준한 관리", "균형 잡힌 식단", "규칙적인 운동",
  "충분한 수면", "전문가와 상담하세요" 같은 상투적인 표현 반복
- 이전 글에서 음식, 숫자, 신체 부위만 바꾼 재작성

출력에는 게시글만 포함한다.
`;

// ---------------------------------------------------------------
// 날짜 관련 함수
// ---------------------------------------------------------------

function getKstDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
}

function getKstDateTimeLabel() {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function getMailSequence() {
  /*
   * GitHub Actions에서 MAIL_SEQUENCE를 1, 2, 3으로 전달할 수 있습니다.
   * 설정하지 않은 경우 실행 시각에 따라 자동으로 구분합니다.
   */
  const envSequence = Number(process.env.MAIL_SEQUENCE);

  if ([1, 2, 3].includes(envSequence)) {
    return envSequence;
  }

  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(new Date())
  );

  if (hour < 12) return 1;
  if (hour < 18) return 2;
  return 3;
}

// ---------------------------------------------------------------
// 메일 순번별 우선 분야
// ---------------------------------------------------------------

function getMailTheme(sequence) {
  const themes = {
    1: `
수면, 아침 습관, 소화, 피부, 육아 중 생기는 생활 불편,
식사 시간, 카페인, 출근 준비와 관련된 소재를 우선한다.
`,
    2: `
직장 스트레스, 눈과 목의 피로, 점심 이후 컨디션,
운동, 근육과 관절, 외식, 여성 건강과 관련된 소재를 우선한다.
`,
    3: `
저녁 습관, 야식, 집안일, 취미, 체중 변화, 구강 건강,
계절 환경, 가족 생활과 관련된 소재를 우선한다.
`,
  };

  return themes[sequence] ?? themes[1];
}

// ---------------------------------------------------------------
// 이력 파일 읽기·저장
// ---------------------------------------------------------------

async function loadHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    console.warn("이력 파일을 읽지 못했습니다:", error.message);
    return [];
  }
}

async function saveHistory(history) {
  const trimmedHistory = history
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_STORED_ITEMS);

  await fs.writeFile(
    HISTORY_FILE,
    JSON.stringify(trimmedHistory, null, 2),
    "utf8"
  );
}

function getRecentHistory(history) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);

  return history
    .filter((item) => {
      const createdAt = new Date(item.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= cutoff;
    })
    .slice(0, MAX_HISTORY_ITEMS);
}

function formatHistoryForPrompt(history) {
  if (history.length === 0) {
    return "최근 생성 이력 없음";
  }

  return history
    .map((item, index) => {
      return [
        `${index + 1}.`,
        `[${item.date ?? "날짜 없음"}]`,
        `제목=${item.title ?? ""}`,
        `주제=${item.topic ?? ""}`,
        `부위·증상=${item.symptom ?? ""}`,
        `계기=${item.trigger ?? ""}`,
        `행동=${item.action ?? ""}`,
        `결말=${item.outcome ?? ""}`,
      ].join(" | ");
    })
    .join("\n");
}

// ---------------------------------------------------------------
// Claude API 공통 호출
// ---------------------------------------------------------------

async function callClaude({
  system,
  user,
  maxTokens = 8000,
  temperature = 1,
}) {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [
        {
          role: "user",
          content: user,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Anthropic API 오류 (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();

  return data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------
// 콘텐츠 생성
// ---------------------------------------------------------------

async function generateContent(recentHistory) {
  const today = getKstDate();
  const mailSequence = getMailSequence();
  const historyText = formatHistoryForPrompt(recentHistory);
  const mailTheme = getMailTheme(mailSequence);

  const userPrompt = `
기준 날짜: ${today}
오늘의 발송 순번: ${mailSequence}

건강 카페 게시글 초안 10개를 작성한다.

이번 발송의 우선 소재:
${mailTheme}

구성 조건:
- 10개 모두 핵심 주제와 이야기 전개가 달라야 한다.
- 같은 증상을 신체 부위나 표현만 바꿔 반복하지 않는다.
- 계절 소재는 최대 2개만 사용한다.
- 영양제 소재는 최대 1개만 사용한다.
- 건강검진이나 검사 결과 소재는 최대 1개만 사용한다.
- 수면이나 피로 소재는 최대 1개만 사용한다.
- 부종이나 혈액순환 소재는 최대 1개만 사용한다.
- 배경도 육아, 직장, 집안일, 외식, 취미, 가족 생활 등으로 분산한다.
- 오늘 앞선 발송에서 사용한 주제도 최근 이력에 있다면 재사용하지 않는다.

아래 이력의 제목뿐 아니라 주제, 증상, 계기, 행동과 결말이
비슷한 글도 생성하지 않는다.

[최근 생성 이력]
${historyText}
[/최근 생성 이력]

출력 형식:

게시글 1

제목 : 제목

본문

----------------------------------------

게시글 2

제목 : 제목

본문

같은 형식으로 게시글 10까지 출력한다.
`;

  return callClaude({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 8000,
    temperature: 1,
  });
}

// ---------------------------------------------------------------
// 생성된 게시글의 중복 방지용 지문 추출
// ---------------------------------------------------------------

async function extractFingerprints(content) {
  const today = getKstDate();
  const mailSequence = getMailSequence();

  const systemPrompt = `
너는 생성된 카페 게시글에서 중복 검사에 필요한 핵심 정보만 추출한다.

반드시 유효한 JSON 배열만 출력한다.
마크다운 코드 블록이나 설명을 붙이지 않는다.
`;

  const userPrompt = `
아래에는 건강 카페 게시글 10개가 있다.

각 게시글에서 다음 항목을 추출한다.

- title: 제목
- topic: 핵심 건강 주제
- symptom: 신체 부위 또는 주요 증상
- trigger: 문제가 시작되거나 신경 쓰이게 된 계기
- action: 작성자가 해본 행동
- outcome: 현재 상태 또는 결말

반드시 아래 형식의 JSON 배열만 출력한다.

[
  {
    "title": "제목",
    "topic": "핵심 주제",
    "symptom": "증상 또는 신체 부위",
    "trigger": "계기",
    "action": "시도한 행동",
    "outcome": "현재 상태 또는 결말"
  }
]

각 값은 짧은 명사구로 요약한다.

[게시글]
${content}
[/게시글]
`;

  const raw = await callClaude({
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 2200,
    temperature: 0,
  });

  const parsed = parseJsonArray(raw);

  return parsed.map((item) => ({
    createdAt: new Date().toISOString(),
    date: today,
    mailSequence,
    title: cleanText(item.title),
    topic: cleanText(item.topic),
    symptom: cleanText(item.symptom),
    trigger: cleanText(item.trigger),
    action: cleanText(item.action),
    outcome: cleanText(item.outcome),
  }));
}

function parseJsonArray(raw) {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const startIndex = cleaned.indexOf("[");
  const endIndex = cleaned.lastIndexOf("]");

  if (startIndex === -1 || endIndex === -1) {
    throw new Error("지문 추출 결과에서 JSON 배열을 찾지 못했습니다.");
  }

  const jsonText = cleaned.slice(startIndex, endIndex + 1);
  const parsed = JSON.parse(jsonText);

  if (!Array.isArray(parsed)) {
    throw new Error("지문 추출 결과가 JSON 배열이 아닙니다.");
  }

  return parsed;
}

function cleanText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 150);
}

// ---------------------------------------------------------------
// 이메일 발송
// ---------------------------------------------------------------

async function sendEmail(content) {
  const gmailUser = requireEnv("GMAIL_USER");
  const gmailPass = requireEnv("GMAIL_APP_PASSWORD");
  const mailTo = requireEnv("MAIL_TO");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  });

  const dateLabel = getKstDateTimeLabel();
  const mailSequence = getMailSequence();

  await transporter.sendMail({
    from: gmailUser,
    to: mailTo,
    subject: `건강 콘텐츠 생성 결과 ${mailSequence}차 - ${dateLabel}`,
    text: content,
  });
}

// ---------------------------------------------------------------
// 환경변수 확인
// ---------------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`환경변수 ${name}가 설정되어 있지 않습니다.`);
  }

  return value;
}

// ---------------------------------------------------------------
// 메인 실행
// ---------------------------------------------------------------

async function main() {
  console.log("최근 생성 이력을 불러오는 중...");

  const history = await loadHistory();
  const recentHistory = getRecentHistory(history);

  console.log(`최근 이력 ${recentHistory.length}개를 불러왔습니다.`);
  console.log("콘텐츠 생성 시작...");

  const content = await generateContent(recentHistory);

  console.log("콘텐츠 생성 완료.");
  console.log("중복 방지용 주제 지문 추출 중...");

  let fingerprints = [];

  try {
    fingerprints = await extractFingerprints(content);
    console.log(`주제 지문 ${fingerprints.length}개 추출 완료.`);
  } catch (error) {
    /*
     * 지문 추출 실패 때문에 이메일까지 발송되지 않는 상황을 막습니다.
     * 생성 콘텐츠는 정상 발송하고 이력 저장만 건너뜁니다.
     */
    console.error("주제 지문 추출 실패:", error.message);
  }

  if (fingerprints.length > 0) {
    await saveHistory([...fingerprints, ...history]);
    console.log("생성 이력 저장 완료.");
  }

  console.log("이메일 발송 중...");
  await sendEmail(content);

  console.log("이메일 발송 완료.");
}

main().catch((error) => {
  console.error("실행 중 오류 발생:", error);
  process.exit(1);
});

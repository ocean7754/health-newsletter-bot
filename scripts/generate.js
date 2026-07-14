// generate.js
// 1) Claude API로 콘텐츠 생성
// 2) 생성 결과를 Gmail로 발송
//
// 필요한 환경변수 (GitHub Actions Secrets에 등록):
//   ANTHROPIC_API_KEY   - Anthropic API 키
//   GMAIL_USER          - 보내는 사람 Gmail 주소
//   GMAIL_APP_PASSWORD  - Gmail 앱 비밀번호 (16자리)
//   MAIL_TO             - 받는 사람 이메일 (콤마로 여러명 가능)

import nodemailer from "nodemailer";

// ---------------------------------------------------------------
// 1. 여기에 실제 사용할 프롬프트를 넣으세요.
//    아래는 예시(플레이스홀더)입니다 — 반드시 검토 후 교체하세요.
//    ⚠️ 실제 사람이 쓴 것처럼 위장하거나 출처를 숨기는 용도로는
//       사용하지 마세요. 콘텐츠에는 AI가 생성했음을 명시하는 것을
//       권장합니다.
// ---------------------------------------------------------------
const SYSTEM_PROMPT = `당신은 건강 뉴스레터 작성 어시스턴트입니다.
독자에게 도움이 되는 건강 정보 콘텐츠를 작성하세요.
각 글 상단에 "AI가 생성한 건강 정보 콘텐츠입니다"라는 안내 문구를 포함하세요.`;

const USER_PROMPT = `오늘 날짜 기준으로 건강 관련 주제 3개를 골라
각각 제목 + 본문(5~7문장) 형태의 정보성 글을 작성해줘.
계절/생활습관/영양 등 다양한 분야에서 균형 있게 골라줘.`;

// ---------------------------------------------------------------

async function generateContent() {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: USER_PROMPT }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API 오류 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return text;
}

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

  const now = new Date();
  const kstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const dateLabel = kstNow.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  await transporter.sendMail({
    from: gmailUser,
    to: mailTo,
    subject: `건강 콘텐츠 생성 결과 - ${dateLabel}`,
    text: content,
  });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name} 가 설정되어 있지 않습니다.`);
  }
  return value;
}

async function main() {
  console.log("콘텐츠 생성 시작...");
  const content = await generateContent();
  console.log("콘텐츠 생성 완료. 이메일 발송 중...");
  await sendEmail(content);
  console.log("이메일 발송 완료.");
}

main().catch((err) => {
  console.error("실행 중 오류 발생:", err);
  process.exit(1);
});

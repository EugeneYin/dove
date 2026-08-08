/**
 * 单词发音，走浏览器内置的 Web Speech API。
 * 音色取决于系统装了哪些英语语音包，无法保证；这里只挑一个英语音色并固定用它。
 */

let voice: SpeechSynthesisVoice | null = null;

/**
 * 各家系统自带的常规朗读音色，按偏好排序。
 *
 * 必须点名挑选，因为系统里还混着大量玩笑音色（Albert、Zarvox、Bubbles……），
 * 它们同样是本地的 en-US 语音，而且在 getVoices() 里排在自然音色前面——
 * 按语言取第一个会选中 Albert，听起来沙哑失真。
 * 另外实测这些音色没有一个带 default 标志，所以也不能指望系统给出首选。
 */
const PREFERRED_VOICES = [
  "Samantha", // macOS / iOS 标准音色
  "Ava",
  "Allison",
  "Susan",
  "Zoe",
  "Alex",
  "Google US English", // Chrome 桌面端与 Android
  "Microsoft Aria",
  "Microsoft Zira",
  "Microsoft David",
  "Daniel", // 其余英语地区的标准音色
  "Karen",
  "Moira",
  "Tessa",
];

/** 上面若一个都没有，至少绕开这些明确的玩笑音色 */
const NOVELTY_VOICES = new Set([
  "Albert",
  "Bad News",
  "Bahh",
  "Bells",
  "Boing",
  "Bubbles",
  "Cellos",
  "Deranged",
  "Eddy",
  "Flo",
  "Fred",
  "Good News",
  "Grandma",
  "Grandpa",
  "Hysterical",
  "Jester",
  "Junior",
  "Kathy",
  "Organ",
  "Ralph",
  "Reed",
  "Rocko",
  "Sandy",
  "Shelley",
  "Superstar",
  "Trinoids",
  "Whisper",
  "Wobble",
  "Zarvox",
]);

/** 音色名常带 "(Enhanced)"、"(英文（美國）)" 之类的后缀 */
const baseName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "").trim();

function pickVoice() {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));

  for (const preferred of PREFERRED_VOICES) {
    const found = english.find((v) => baseName(v.name) === preferred);
    if (found) {
      voice = found;
      return;
    }
  }

  const usable = english.filter((v) => !NOVELTY_VOICES.has(baseName(v.name)));
  voice = usable.find((v) => v.lang === "en-US") ?? usable[0] ?? english[0] ?? null;
}

export function voiceName(): string | null {
  return voice?.name ?? null;
}

export function initSpeech() {
  if (!("speechSynthesis" in window)) return;
  pickVoice();
  // Chrome 的语音列表是异步加载的，首次为空
  speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

export function canSpeak(): boolean {
  return "speechSynthesis" in window;
}

export function speak(word: string) {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = voice?.lang ?? "en-US";
  if (voice) u.voice = voice;
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

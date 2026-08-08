/**
 * 单词发音，走浏览器内置的 Web Speech API。
 * 音色取决于系统装了哪些英语语音包，无法保证；这里只挑一个英语音色并固定用它。
 */

let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice =
    voices.find((v) => v.lang === "en-US" && v.localService) ??
    voices.find((v) => v.lang.startsWith("en") && v.localService) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null;
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

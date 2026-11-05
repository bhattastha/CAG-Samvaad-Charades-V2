import { create } from "zustand";
import { usePrefs } from "./store";

export interface Line { id: string; en: string; hi: string; spoken?: boolean }

/**
 * Sahayika's voice, fully under the player's control: play, pause, resume, stop.
 * Nothing plays automatically unless the player chose "auto" in settings (default: tap to listen).
 * Sources: pre-generated BHASHINI audio → live BHASHINI TTS → browser speechSynthesis (en-IN, male).
 */
type Status = "idle" | "loading" | "playing" | "paused";
interface VoiceState { status: Status; line: Line | null }
export const useVoice = create<VoiceState>(() => ({ status: "idle", line: null }));

let audio: HTMLAudioElement | null = null;
let usingSynth = false;
const blobCache = new Map<string, string>();
const set = (s: Partial<VoiceState>) => useVoice.setState(s);

function pickVoice(): SpeechSynthesisVoice | undefined {
  const vs = window.speechSynthesis?.getVoices() ?? [];
  // Sahayika is a female guide: prefer a warm female English voice (Indian English first), then any English voice
  const female = /\bfemale\b|heera|neerja|kalpana|veena|lekha|aditi|raveena|samantha|karen|moira|tessa|serena|victoria|zira|google uk english female|google us english/i;
  const notFemale = /\bmale\b/i;
  return vs.find((v) => v.lang === "en-IN" && female.test(v.name) && !notFemale.test(v.name))
    ?? vs.find((v) => v.lang.startsWith("en") && female.test(v.name) && !notFemale.test(v.name))
    ?? vs.find((v) => v.lang === "en-IN")
    ?? vs.find((v) => v.lang.startsWith("en"));
}

function speakSynth(line: Line) {
  const s = window.speechSynthesis;
  if (!s) { set({ status: "idle", line: null }); return; }
  s.cancel();
  const u = new SpeechSynthesisUtterance(line.en);
  u.lang = "en-IN";
  u.pitch = 1.05;
  u.volume = Math.max(0.2, usePrefs.getState().volume);
  const v = pickVoice();
  if (v) u.voice = v;
  u.onend = () => { if (useVoice.getState().line?.id === line.id) set({ status: "idle", line: null }); };
  u.onerror = u.onend;
  usingSynth = true;
  s.speak(u);
  set({ status: "playing", line });
}

async function playAudioUrl(url: string, line: Line) {
  usingSynth = false;
  audio = new Audio(url);
  audio.volume = Math.max(0.2, usePrefs.getState().volume);
  audio.onended = () => set({ status: "idle", line: null });
  await audio.play();
  set({ status: "playing", line });
}

export function stop() {
  audio?.pause();
  audio = null;
  window.speechSynthesis?.cancel();
  set({ status: "idle", line: null });
}

export function pause() {
  const st = useVoice.getState();
  if (st.status !== "playing") return;
  if (usingSynth) window.speechSynthesis?.pause();
  else audio?.pause();
  set({ status: "paused" });
}

export function resume() {
  const st = useVoice.getState();
  if (st.status !== "paused") return;
  if (usingSynth) window.speechSynthesis?.resume();
  else audio?.play();
  set({ status: "playing" });
}

export async function play(line: Line) {
  if (line.spoken === false || !line.en) return;
  stop();
  set({ status: "loading", line });
  try {
    const fixed = !/\{\w+\}/.test(line.en) && line.id && !["llm", "faq", "refuse", "chat", "report", "total"].includes(line.id);
    if (fixed) {
      const r = await fetch(`/api/sahayika/audio/${encodeURIComponent(line.id)}`);
      if (r.ok) return await playAudioUrl(URL.createObjectURL(await r.blob()), line);
    }
    let url = blobCache.get(line.en);
    if (!url) {
      const r = await fetch("/api/sahayika/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: line.en.slice(0, 400) }) });
      if (r.ok) { url = URL.createObjectURL(await r.blob()); blobCache.set(line.en, url); }
    }
    if (useVoice.getState().line?.id !== line.id) return; // stopped while loading
    if (url) return await playAudioUrl(url, line);
  } catch { /* fall through to the browser voice */ }
  if (useVoice.getState().line?.id === line.id) speakSynth(line);
}

/** Called by scenes when a line appears: speaks only in "auto" mode, after the first tap. */
export function announce(line: Line | null | undefined) {
  const p = usePrefs.getState();
  if (!line || p.voice !== "auto" || !p.unlocked) return;
  play(line);
}

export function toggle(line: Line) {
  const st = useVoice.getState();
  if (st.line?.id === line.id && st.line.en === line.en) {
    if (st.status === "playing") return pause();
    if (st.status === "paused") return resume();
    if (st.status === "loading") return stop();
  }
  return play(line);
}

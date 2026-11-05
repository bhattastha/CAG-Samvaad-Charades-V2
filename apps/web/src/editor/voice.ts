/** Voice typing (परख only): BHASHINI streaming ASR via the API relay, else Web Speech (hi-IN). */
export interface VoiceCallbacks { onInterim(t: string): void; onFinal(t: string): void; onUnavailable(): void; onState(s: "idle" | "listening"): void }

const FULL_STOP = /\s*(पूर्ण\s*विराम|पूर्णविराम|poorn viraam|purn viram)\s*/gi;
/** Spoken "पूर्ण विराम" → "।", without doubling a danda the punctuation model already added. */
export function applyDanda(text: string) {
  return text.replace(FULL_STOP, "। ").replace(/[।.]\s*।/g, "।").replace(/\s+।/g, "।").replace(/\s+/g, " ").trim();
}

export class VoiceTyping {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private rec: any = null;
  private silence: ReturnType<typeof setTimeout> | undefined;
  constructor(private cb: VoiceCallbacks) {}

  async start() {
    this.cb.onState("listening");
    const ok = await this.startStreaming().catch(() => false);
    if (!ok && !this.startWebSpeech()) { this.cb.onState("idle"); this.cb.onUnavailable(); }
  }

  private startStreaming(): Promise<boolean> {
    return new Promise((resolve) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/speech/asr/stream`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      let settled = false;
      const done = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
      const timer = setTimeout(() => { ws.close(); done(false); }, 6000);
      ws.onmessage = async (e) => {
        const m = JSON.parse(String(e.data));
        if (m.type === "unavailable" || m.type === "error") { clearTimeout(timer); ws.close(); this.stopAudio(); done(false); return; }
        if (m.type === "ready") {
          clearTimeout(timer);
          try { await this.startAudio((buf) => ws.readyState === 1 && ws.send(buf)); done(true); } catch { done(false); return; }
          // BHASHINI sometimes accepts the stream but never answers: switch to the browser's Hindi recogniser
          this.silence = setTimeout(() => this.switchToWebSpeech(), 8000);
        }
        if (m.type === "text") {
          clearTimeout(this.silence);
          const t = applyDanda(m.text ?? "");
          if (m.final) { this.cb.onInterim(""); if (t) this.cb.onFinal(t); } else this.cb.onInterim(t);
        }
      };
      ws.onerror = () => { clearTimeout(timer); done(false); };
      ws.onclose = () => { if (settled) this.cb.onState("idle"); };
    });
  }

  private async startAudio(send: (b: ArrayBuffer) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    const src = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, "pcm16");
    node.port.onmessage = (e) => { if (e.data.pcm) send(e.data.pcm); };
    src.connect(node);
  }

  private switchToWebSpeech() {
    if (!this.ws) return;
    this.ws.onclose = null;
    try { this.ws.send("stop"); } catch { /* closed */ }
    this.ws.close(); this.ws = null;
    this.stopAudio();
    if (!this.startWebSpeech()) { this.cb.onState("idle"); this.cb.onUnavailable(); }
  }

  private startWebSpeech(): boolean {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return false;
    const rec = new SR();
    rec.lang = "hi-IN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) { this.cb.onInterim(""); this.cb.onFinal(applyDanda(r[0].transcript)); }
        else interim += r[0].transcript;
      }
      if (interim) this.cb.onInterim(applyDanda(interim));
    };
    rec.onerror = (e: any) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") this.cb.onUnavailable(); };
    rec.onend = () => this.cb.onState("idle");
    try { rec.start(); this.rec = rec; return true; } catch { return false; }
  }

  private stopAudio() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null; this.ctx = null;
  }

  stop() {
    clearTimeout(this.silence);
    try { this.ws?.send("stop"); } catch { /* closed */ }
    this.ws?.close(); this.ws = null;
    this.rec?.stop(); this.rec = null;
    this.stopAudio();
    this.cb.onInterim("");
    this.cb.onState("idle");
  }
}

/** Mic check before the clock starts (§15.1): asks permission and reports a live level. */
export async function micCheck(onLevel: (v: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const data = new Uint8Array(an.fftSize);
  let raf = 0;
  const tick = () => {
    an.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    onLevel(peak);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); };
}

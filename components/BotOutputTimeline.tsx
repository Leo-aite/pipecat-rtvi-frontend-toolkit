import React, { useRef, useEffect, useCallback } from 'react';
import { usePipecatClient, usePipecatClientMediaTrack } from '@pipecat-ai/client-react';
import { RTVIEvent } from '@pipecat-ai/client-js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WaveformSnapshot {
  t: number;
  samples: number[];
}

interface AlignedToken {
  text: string;
  alignedT: number;
}

interface BotBoundary {
  t: number;
  type: 'llm-start' | 'llm-stop' | 'speak-start' | 'speak-stop';
}

// ─── Colors ──────────────────────────────────────────────────────────────────

const BG = '#ffffff';
const LLM_BG = '#f5f0ff';
const LLM_COLOR = '#5b21b6';
const LLM_ZERO = '#e9d5ff';
const TTS_BG = '#f0fff4';
const TTS_COLOR = '#047857';
const BORDER_COLOR = '#dddddd';
const AXIS_COLOR = '#666666';
const AXIS_FONT = '9px monospace';

// ─── Drawing ─────────────────────────────────────────────────────────────────

function drawBotTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  waveform: WaveformSnapshot[],
  alignedTokens: AlignedToken[],
  botBoundaries: BotBoundary[],
  viewStartMs: number,
  viewEndMs: number,
) {
  const MARGIN_L = 32;
  const MARGIN_R = 6;
  const MARGIN_B = 14;
  const plotW = width - MARGIN_L - MARGIN_R;
  const contentH = height - MARGIN_B;
  const llmH = contentH * 0.6;
  const ttsY = llmH;
  const ttsH = contentH * 0.4;
  const timeSpan = viewEndMs - viewStartMs;
  const tToX = (t: number) => MARGIN_L + ((t - viewStartMs) / timeSpan) * plotW;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  // LLM lane
  ctx.fillStyle = LLM_BG;
  ctx.fillRect(MARGIN_L, 0, plotW, llmH);

  const zeroY = llmH / 2;
  ctx.strokeStyle = LLM_ZERO;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(MARGIN_L, zeroY);
  ctx.lineTo(MARGIN_L + plotW, zeroY);
  ctx.stroke();

  // Waveform
  if (waveform.length > 0) {
    const sampleRate = 44100;
    ctx.strokeStyle = LLM_COLOR;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    let started = false;
    for (const snap of waveform) {
      const snapDurMs = snap.samples.length / (sampleRate / 1000);
      if (snap.t + snapDurMs < viewStartMs || snap.t > viewEndMs) continue;
      for (let i = 0; i < snap.samples.length; i++) {
        const sampleT = snap.t + (i / snap.samples.length) * snapDurMs;
        if (sampleT < viewStartMs || sampleT > viewEndMs) continue;
        const x = tToX(sampleT);
        const v = (snap.samples[i] - 128) / 128;
        const y = zeroY - v * (llmH / 2 - 4);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Lane divider
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN_L, ttsY);
  ctx.lineTo(MARGIN_L + plotW, ttsY);
  ctx.stroke();

  // TTS lane
  ctx.fillStyle = TTS_BG;
  ctx.fillRect(MARGIN_L, ttsY, plotW, ttsH);

  // Speaking regions
  const speakStarts: number[] = [];
  for (const b of botBoundaries) {
    if (b.type === 'speak-start') speakStarts.push(b.t);
    if (b.type === 'speak-stop' && speakStarts.length > 0) {
      const start = speakStarts.pop()!;
      const s = Math.max(start, viewStartMs);
      const e = Math.min(b.t, viewEndMs);
      if (s < e) {
        ctx.fillStyle = TTS_COLOR;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(tToX(s), ttsY, tToX(e) - tToX(s), ttsH);
        ctx.globalAlpha = 1;
      }
    }
  }
  if (speakStarts.length > 0) {
    const s = Math.max(speakStarts[speakStarts.length - 1], viewStartMs);
    if (s < viewEndMs) {
      ctx.fillStyle = TTS_COLOR;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(tToX(s), ttsY, tToX(viewEndMs) - tToX(s), ttsH);
      ctx.globalAlpha = 1;
    }
  }

  // Boundary markers
  for (const b of botBoundaries) {
    if (b.t < viewStartMs || b.t > viewEndMs) continue;
    const x = tToX(b.t);
    let color: string, label: string;
    switch (b.type) {
      case 'llm-start':   color = LLM_COLOR; label = 'LLM'; break;
      case 'llm-stop':    color = LLM_COLOR; label = '/LLM'; break;
      case 'speak-start': color = TTS_COLOR; label = 'SPEAK'; break;
      case 'speak-stop':  color = TTS_COLOR; label = '/SPEAK'; break;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, contentH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, 8);
  }

  // Lane labels
  ctx.fillStyle = LLM_COLOR;
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('LLM', MARGIN_L - 3, zeroY + 3);
  ctx.fillStyle = TTS_COLOR;
  ctx.fillText('TTS', MARGIN_L - 3, ttsY + ttsH / 2 + 3);

  // Aligned tokens
  ctx.font = '9px monospace';
  let nextMinX = 0;
  for (const tok of alignedTokens) {
    if (tok.alignedT < viewStartMs || tok.alignedT > viewEndMs) continue;
    const rawX = tToX(tok.alignedT);
    const x = Math.max(rawX, nextMinX);
    const trimmed = tok.text.trim();
    if (!trimmed) continue;

    ctx.strokeStyle = TTS_COLOR;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rawX, ttsY + 1);
    ctx.lineTo(rawX, ttsY + ttsH - 1);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = TTS_COLOR;
    ctx.textAlign = 'left';
    ctx.fillText(trimmed, x + 1, ttsY + ttsH / 2 + 3);
    nextMinX = x + ctx.measureText(trimmed).width;
  }

  // Time axis
  ctx.fillStyle = AXIS_COLOR;
  ctx.strokeStyle = AXIS_COLOR;
  ctx.font = AXIS_FONT;
  ctx.textAlign = 'center';
  ctx.lineWidth = 0.5;
  const tickInterval = timeSpan <= 2000 ? 200 : timeSpan <= 5000 ? 500 : 1000;
  const firstTick = Math.ceil(viewStartMs / tickInterval) * tickInterval;
  for (let t = firstTick; t <= viewEndMs; t += tickInterval) {
    const x = tToX(t);
    ctx.beginPath();
    ctx.moveTo(x, height - MARGIN_B);
    ctx.lineTo(x, height - MARGIN_B + 4);
    ctx.stroke();
    ctx.fillText((t / 1000).toFixed(1) + 's', x, height - 1);
  }

  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN_L, 0, plotW, contentH);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface BotOutputTimelineProps {
  height?: number;
  /** Shared view refs for synced zoom/pan with sibling timelines */
  sharedViewStartRef?: React.MutableRefObject<number>;
  sharedViewEndRef?: React.MutableRefObject<number>;
  sharedT0Ref?: React.MutableRefObject<number>;
}

export const BotOutputTimeline: React.FC<BotOutputTimelineProps> = ({
  height = 160,
  sharedViewStartRef,
  sharedViewEndRef,
  sharedT0Ref,
}) => {
  const client = usePipecatClient();
  const botAudioTrack = usePipecatClientMediaTrack('audio', 'bot');

  const localT0 = useRef(performance.now());
  const t0 = sharedT0Ref || localT0;
  const now = () => performance.now() - t0.current;

  const localViewStart = useRef(0);
  const localViewEnd = useRef(60000);
  const viewStartRef = sharedViewStartRef || localViewStart;
  const viewEndRef = sharedViewEndRef || localViewEnd;

  const waveformRef = useRef<WaveformSnapshot[]>([]);
  const alignedTokensRef = useRef<AlignedToken[]>([]);
  const botBoundariesRef = useRef<BotBoundary[]>([]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const flushRef = useRef<ReturnType<typeof setInterval>>();
  const animRef = useRef(0);
  const lastCaptureRef = useRef(0);

  // Connect to bot audio track
  useEffect(() => {
    if (!botAudioTrack) return;
    const ctx = new AudioContext({ sampleRate: 44100 });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    const stream = new MediaStream([botAudioTrack]);
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    return () => { source.disconnect(); ctx.close(); };
  }, [botAudioTrack]);

  // Continuous capture
  const captureLoop = useCallback(() => {
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const t = now();
    if (analyser && dataArray && t - lastCaptureRef.current >= 50) {
      analyser.getByteTimeDomainData(dataArray);
      waveformRef.current.push({ t, samples: Array.from(dataArray) });
      lastCaptureRef.current = t;
    }
    animRef.current = requestAnimationFrame(captureLoop);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(captureLoop);
    return () => cancelAnimationFrame(animRef.current);
  }, [captureLoop]);

  // Redraw
  useEffect(() => {
    flushRef.current = setInterval(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const w = container.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      drawBotTimeline(ctx, w, height, waveformRef.current, alignedTokensRef.current,
        botBoundariesRef.current, viewStartRef.current, viewEndRef.current);
    }, 66);
    return () => clearInterval(flushRef.current);
  }, [height]);

  // Zoom/pan
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartViewRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const MARGIN_L = 32, MARGIN_R = 6;
    const clampView = (start: number, span: number) => {
      let s = Math.max(0, start);
      const maxTime = now();
      if (s + span > maxTime + 2000) s = Math.max(0, maxTime + 2000 - span);
      viewStartRef.current = s;
      viewEndRef.current = s + span;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const plotW = rect.width - MARGIN_L - MARGIN_R;
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - MARGIN_L) / plotW));
      const span = viewEndRef.current - viewStartRef.current;
      const delta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 50);
      const newSpan = Math.max(500, Math.min(300000, span * (1 + delta * 0.002)));
      clampView(viewStartRef.current + frac * span - frac * newSpan, newSpan);
    };
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      dragStartXRef.current = e.clientX;
      dragStartViewRef.current = viewStartRef.current;
      canvas.style.cursor = 'grabbing';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const plotW = rect.width - MARGIN_L - MARGIN_R;
      const span = viewEndRef.current - viewStartRef.current;
      clampView(dragStartViewRef.current - ((e.clientX - dragStartXRef.current) / plotW) * span, span);
    };
    const onMouseUp = () => { isDraggingRef.current = false; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.style.cursor = 'grab';
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // RTVI events — self-contained via client.on()
  useEffect(() => {
    if (!client) return;

    const onLlmStarted = () => botBoundariesRef.current.push({ t: now(), type: 'llm-start' });
    const onLlmStopped = () => botBoundariesRef.current.push({ t: now(), type: 'llm-stop' });
    const onSpeakStart = () => botBoundariesRef.current.push({ t: now(), type: 'speak-start' });
    const onSpeakStop = () => botBoundariesRef.current.push({ t: now(), type: 'speak-stop' });

    // With pipecat 0.0.105+, BotTtsText fires per word with PTS synced to audio
    const onBotTtsText = (data: any) => {
      const text = data?.text || '';
      if (text.trim()) {
        alignedTokensRef.current.push({ text: text.trim(), alignedT: now() });
      }
    };

    client.on(RTVIEvent.BotLlmStarted, onLlmStarted);
    client.on(RTVIEvent.BotLlmStopped, onLlmStopped);
    client.on(RTVIEvent.BotTtsText, onBotTtsText);
    client.on(RTVIEvent.BotStartedSpeaking, onSpeakStart);
    client.on(RTVIEvent.BotStoppedSpeaking, onSpeakStop);

    return () => {
      client.off(RTVIEvent.BotLlmStarted, onLlmStarted);
      client.off(RTVIEvent.BotLlmStopped, onLlmStopped);
      client.off(RTVIEvent.BotTtsText, onBotTtsText);
      client.off(RTVIEvent.BotStartedSpeaking, onSpeakStart);
      client.off(RTVIEvent.BotStoppedSpeaking, onSpeakStop);
    };
  }, [client]);

  return (
    <div ref={containerRef} style={{ width: '100%', fontFamily: 'monospace' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 3px 3px', display: 'block' }}
      />
    </div>
  );
};

export default BotOutputTimeline;

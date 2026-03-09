import React, { useState, useRef, useEffect } from 'react';
import { usePipecatClient } from '@pipecat-ai/client-react';
import { RTVIEvent } from '@pipecat-ai/client-js';

const stages = [
  { key: 'mic', label: 'Mic', color: '#ef4444' },
  { key: 'stt', label: 'STT', color: '#f97316' },
  { key: 'llm', label: 'LLM', color: '#eab308' },
  { key: 'tts', label: 'TTS', color: '#22c55e' },
  { key: 'speaker', label: 'Speaker', color: '#8b5cf6' },
];

const RTVIPipelineProgressBar: React.FC = () => {
  const client = usePipecatClient();
  const transportState = client?.state ?? 'disconnected';
  const connected = transportState === 'ready';

  const [activity, setActivity] = useState<Record<string, boolean>>({
    mic: false, stt: false, llm: false, tts: false, speaker: false,
  });

  const sttTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const ttsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const llmFallbackRef = useRef<ReturnType<typeof setTimeout>>();
  const botJustStoppedRef = useRef(false);

  // Reset on connect/disconnect
  useEffect(() => {
    setActivity({ mic: false, stt: false, llm: false, tts: false, speaker: false });
  }, [transportState]);

  // Subscribe to RTVI events
  useEffect(() => {
    if (!client) return;

    const onUserStartedSpeaking = () => {
      setActivity(prev => ({ ...prev, mic: true }));
    };

    const onUserStoppedSpeaking = () => {
      setActivity(prev => ({ ...prev, mic: false }));
      llmFallbackRef.current = setTimeout(() => {
        setActivity(prev => {
          if (!prev.llm && !prev.speaker) return { ...prev, llm: true };
          return prev;
        });
      }, 300);
    };

    const onUserTranscript = () => {
      if (botJustStoppedRef.current) return;
      setActivity(prev => prev.stt ? prev : { ...prev, stt: true });
      clearTimeout(sttTimeoutRef.current);
      sttTimeoutRef.current = setTimeout(() => {
        setActivity(prev => !prev.stt ? prev : { ...prev, stt: false });
      }, 400);
    };

    const onBotLlmStarted = () => {
      clearTimeout(llmFallbackRef.current);
      setActivity(prev => ({ ...prev, llm: true }));
    };

    const onBotLlmStopped = () => {
      setActivity(prev => ({ ...prev, llm: false }));
    };

    const onBotTtsText = () => {
      setActivity(prev => ({ ...prev, tts: true }));
      clearTimeout(ttsTimeoutRef.current);
      ttsTimeoutRef.current = setTimeout(() => {
        setActivity(prev => !prev.tts ? prev : { ...prev, tts: false });
      }, 1000);
    };

    const onBotTtsStarted = () => {
      setActivity(prev => ({ ...prev, tts: true }));
    };

    const onBotTtsStopped = () => {
      setActivity(prev => ({ ...prev, tts: false }));
    };

    const onBotStartedSpeaking = () => {
      setActivity(prev => ({ ...prev, speaker: true }));
    };

    const onBotStoppedSpeaking = () => {
      setActivity(prev => ({ ...prev, speaker: false, tts: false, llm: false }));
      botJustStoppedRef.current = true;
      setTimeout(() => { botJustStoppedRef.current = false; }, 500);
    };

    client.on(RTVIEvent.UserStartedSpeaking, onUserStartedSpeaking);
    client.on(RTVIEvent.UserStoppedSpeaking, onUserStoppedSpeaking);
    client.on(RTVIEvent.UserTranscript, onUserTranscript);
    client.on(RTVIEvent.BotLlmStarted, onBotLlmStarted);
    client.on(RTVIEvent.BotLlmStopped, onBotLlmStopped);
    client.on(RTVIEvent.BotTtsText, onBotTtsText);
    client.on(RTVIEvent.BotTtsStarted, onBotTtsStarted);
    client.on(RTVIEvent.BotTtsStopped, onBotTtsStopped);
    client.on(RTVIEvent.BotStartedSpeaking, onBotStartedSpeaking);
    client.on(RTVIEvent.BotStoppedSpeaking, onBotStoppedSpeaking);

    return () => {
      client.off(RTVIEvent.UserStartedSpeaking, onUserStartedSpeaking);
      client.off(RTVIEvent.UserStoppedSpeaking, onUserStoppedSpeaking);
      client.off(RTVIEvent.UserTranscript, onUserTranscript);
      client.off(RTVIEvent.BotLlmStarted, onBotLlmStarted);
      client.off(RTVIEvent.BotLlmStopped, onBotLlmStopped);
      client.off(RTVIEvent.BotTtsText, onBotTtsText);
      client.off(RTVIEvent.BotTtsStarted, onBotTtsStarted);
      client.off(RTVIEvent.BotTtsStopped, onBotTtsStopped);
      client.off(RTVIEvent.BotStartedSpeaking, onBotStartedSpeaking);
      client.off(RTVIEvent.BotStoppedSpeaking, onBotStoppedSpeaking);
      clearTimeout(sttTimeoutRef.current);
      clearTimeout(ttsTimeoutRef.current);
      clearTimeout(llmFallbackRef.current);
    };
  }, [client]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-4 py-2.5 px-4">
      <div className="flex items-center justify-center gap-1">
        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mr-2">Pipeline</span>
        {stages.map((stage, i) => {
          const isActive = connected && activity[stage.key];
          return (
            <React.Fragment key={stage.key}>
              {i > 0 && (
                <svg
                  className="w-5 h-3 flex-shrink-0 transition-colors duration-300"
                  style={{
                    color: connected && activity[stages[i - 1].key] ? stages[i - 1].color : '#d1d5db',
                  }}
                  viewBox="0 0 20 12"
                >
                  <path
                    d="M0 6 L14 6 M10 2 L16 6 L10 10"
                    stroke="currentColor"
                    fill="none"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              <div
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-center min-w-[48px] border transition-all duration-200 ease-out"
                style={{
                  backgroundColor: isActive ? stage.color + '18' : '#f9fafb',
                  borderColor: isActive ? stage.color : '#e5e7eb',
                  color: isActive ? stage.color : '#9ca3af',
                  transform: isActive ? 'scale(1.15)' : 'scale(1)',
                  boxShadow: isActive
                    ? `0 0 14px ${stage.color}40, 0 2px 6px ${stage.color}25`
                    : 'none',
                }}
              >
                {stage.label}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default RTVIPipelineProgressBar;

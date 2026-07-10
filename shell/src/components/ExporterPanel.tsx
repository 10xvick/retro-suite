import React, { useState, useEffect, useRef, useCallback } from 'react';
import { extractAssembledSprites, WAVRecorder, AssembledSprite } from '../utils/Exporter';
import { EmulatorCore } from '../emulator';

interface ExporterPanelProps {
  core: EmulatorCore | null;
}

interface SpriteTracker {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Quick exact canvas pixel equality check
function areCanvasesEqual(c1: HTMLCanvasElement, c2: HTMLCanvasElement): boolean {
  if (c1.width !== c2.width || c1.height !== c2.height) return false;
  const ctx1 = c1.getContext('2d');
  const ctx2 = c2.getContext('2d');
  if (!ctx1 || !ctx2) return false;
  
  const img1 = ctx1.getImageData(0, 0, c1.width, c1.height).data;
  const img2 = ctx2.getImageData(0, 0, c2.width, c2.height).data;
  
  for (let i = 0; i < img1.length; i++) {
    if (img1[i] !== img2[i]) return false;
  }
  return true;
}

export function ExporterPanel({ core }: ExporterPanelProps) {
  const [exportTab, setExportTab] = useState<'sprites' | 'audio'>('sprites');
  const [sprites, setSprites] = useState<AssembledSprite[]>([]);
  
  // Selection and Proximity Tracker State
  const [selectedTracker, setSelectedTracker] = useState<SpriteTracker | null>(null);
  const selectedTrackerRef = useRef<SpriteTracker | null>(null);
  
  // Animation Recording (Accumulation) State
  const [isRecordingAnims, setIsRecordingAnims] = useState(false);
  const [recordedFrames, setRecordedFrames] = useState<AssembledSprite[]>([]);
  const recordedFramesRef = useRef<AssembledSprite[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [spriteScale, setSpriteScale] = useState(() => {
    const saved = parseInt(localStorage.getItem('retro_station_sprite_scale') || '2');
    return saved >= 1 && saved <= 4 ? saved : 2;
  });
  
  // Real-time Audio Level State (VU Meter)
  const [leftLevel, setLeftLevel] = useState(0);
  const [rightLevel, setRightLevel] = useState(0);
  
  const [gridWidth, setGridWidth] = useState(240);
  const gridRefVal = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const wavRecorderRef = useRef<WAVRecorder>(new WAVRecorder());
  const recorderNodeRef = useRef<ScriptProcessorNode | null>(null);
  const refreshIntervalRef = useRef<any>(null);

  // Sync selectedTrackerRef
  useEffect(() => {
    selectedTrackerRef.current = selectedTracker;
  }, [selectedTracker]);

  // ResizeObserver callback ref
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    gridRefVal.current = node;

    if (node) {
      const observer = new ResizeObserver((entries) => {
        const width = entries[0].contentRect.width;
        if (width > 0) {
          setGridWidth(width);
        }
      });
      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);

  // Function to refresh extracted sprites from OAM
  const refreshSprites = () => {
    if (!core) return;
    try {
      const extracted = extractAssembledSprites(core);
      
      // Update Live view list
      setSprites(extracted);

      // Proximity tracking logic to follow the character in real time
      const tracker = selectedTrackerRef.current;
      if (tracker) {
        let bestMatch: AssembledSprite | null = null;
        let bestDist = 60; // Max allowed distance to hop between consecutive frames
        
        for (const s of extracted) {
          const dist = Math.sqrt(Math.pow(s.x - tracker.x, 2) + Math.pow(s.y - tracker.y, 2));
          if (dist < bestDist) {
            bestDist = dist;
            bestMatch = s;
          }
        }

        if (bestMatch) {
          const updatedTracker = {
            x: bestMatch.x,
            y: bestMatch.y,
            width: bestMatch.width,
            height: bestMatch.height
          };
          setSelectedTracker(updatedTracker);
          selectedTrackerRef.current = updatedTracker;

          // If recording animations, accumulate this tracked sprite's unique frames
          if (isRecordingAnims) {
            const frames = [...recordedFramesRef.current];
            const duplicate = frames.some(f => areCanvasesEqual(f.canvas, (bestMatch as AssembledSprite).canvas));
            if (!duplicate) {
              const newFrame = {
                ...(bestMatch as AssembledSprite),
                id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`
              };
              frames.push(newFrame);
              recordedFramesRef.current = frames;
              setRecordedFrames(frames);
            }
          }
        }
      } else if (isRecordingAnims) {
        // Fallback: If no tracker is selected, accumulate ALL unique sprites on screen
        const frames = [...recordedFramesRef.current];
        let updated = false;
        
        extracted.forEach(s => {
          const duplicate = frames.some(f => areCanvasesEqual(f.canvas, s.canvas));
          if (!duplicate) {
            frames.push({
              ...s,
              id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`
            });
            updated = true;
          }
        });
        
        if (updated) {
          recordedFramesRef.current = frames;
          setRecordedFrames(frames);
        }
      }
    } catch (err) {
      console.error('Failed to extract sprites:', err);
    }
  };

  // Setup auto-refresh intervals (fast interval when recording to capture quick transitions)
  useEffect(() => {
    refreshSprites();
    
    if (autoRefresh && core) {
      const intervalMs = isRecordingAnims ? 50 : 500;
      refreshIntervalRef.current = setInterval(() => {
        refreshSprites();
      }, intervalMs);
    } else {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    }

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [core, autoRefresh, isRecordingAnims]);

  // Clean up recording on unmount
  useEffect(() => {
    return () => {
      stopRecordingAndCleanUp(false);
    };
  }, []);

  const startRecording = () => {
    if (!core) return;
    const audioCtx = core.getAudioContext();
    const audioNode = core.getAudioNode();
    
    if (!audioCtx || !audioNode) {
      alert('Sound is disabled or not initialized. Start the core and enable sound first!');
      return;
    }

    try {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      wavRecorderRef.current.start(audioCtx.sampleRate, (duration) => {
        setRecordDuration(duration);
      });

      // Create ScriptProcessorNode (2 input channels, 2 output channels)
      const bufferSize = 4096;
      const node = audioCtx.createScriptProcessor(bufferSize, 2, 2);
      
      node.onaudioprocess = (e) => {
        const left = e.inputBuffer.getChannelData(0);
        const right = e.inputBuffer.getChannelData(1);
        wavRecorderRef.current.record(left, right);
        
        // Calculate root-mean-square (RMS) for VU meters
        let sumLeft = 0;
        let sumRight = 0;
        for (let i = 0; i < left.length; i++) {
          sumLeft += left[i] * left[i];
          sumRight += right[i] * right[i];
        }
        setLeftLevel(Math.sqrt(sumLeft / left.length));
        setRightLevel(Math.sqrt(sumRight / right.length));

        // Pass through audio to the speakers so the user can hear it
        const outputLeft = e.outputBuffer.getChannelData(0);
        const outputRight = e.outputBuffer.getChannelData(1);
        outputLeft.set(left);
        outputRight.set(right);
      };

      // Disconnect original node from speakers to prevent duplicate paths
      try {
        audioNode.disconnect(audioCtx.destination);
      } catch (err) {
        // Safe fallback if it wasn't directly connected
      }

      // Route through processor node
      audioNode.connect(node);
      node.connect(audioCtx.destination);
      
      recorderNodeRef.current = node;
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  const stopRecordingAndCleanUp = (shouldDownload: boolean) => {
    const audioCtx = core?.getAudioContext();
    const audioNode = core?.getAudioNode();

    if (recorderNodeRef.current && audioCtx && audioNode) {
      try {
        audioNode.disconnect(recorderNodeRef.current);
        recorderNodeRef.current.disconnect(audioCtx.destination);
      } catch (e) {
        // Ignore disconnect errors
      }
      recorderNodeRef.current = null;

      // Reconnect original audio node to speakers
      try {
        audioNode.connect(audioCtx.destination);
      } catch (err) {
        // Safe fallback
      }
    }
    
    if (isRecording) {
      setIsRecording(false);
      setLeftLevel(0);
      setRightLevel(0);
      const blob = wavRecorderRef.current.stop();
      if (shouldDownload) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${core?.id || 'retro'}_audio_dump.wav`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
  };

  const downloadSprite = (sprite: AssembledSprite) => {
    const a = document.createElement('a');
    a.href = sprite.canvas.toDataURL();
    a.download = `${sprite.id}.png`;
    a.click();
  };

  // Stitches all unique recorded frames into a single horizontal strip spritesheet
  const downloadRecordedSpriteSheet = () => {
    if (recordedFrames.length === 0) return;
    
    const frameWidth = recordedFrames[0].width;
    const frameHeight = recordedFrames[0].height;
    
    const canvas = document.createElement('canvas');
    canvas.width = frameWidth * recordedFrames.length;
    canvas.height = frameHeight;
    
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    recordedFrames.forEach((frame, index) => {
      ctx.drawImage(frame.canvas, index * frameWidth, 0);
    });
    
    const a = document.createElement('a');
    a.href = canvas.toDataURL();
    a.download = `anim_${core?.id || 'retro'}_${frameWidth}x${frameHeight}_${recordedFrames.length}f.png`;
    a.click();
  };

  const downloadAllSprites = () => {
    if (sprites.length === 0) return;
    sprites.forEach((sprite, index) => {
      setTimeout(() => {
        downloadSprite(sprite);
      }, index * 120);
    });
  };

  const formatDuration = (sec: number) => {
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    const tenths = Math.floor((sec * 10) % 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`;
  };

  const renderVuBar = (val: number) => {
    const pct = Math.min(100, Math.round(val * 350));
    let barColor = 'linear-gradient(to right, #4af626 70%, #f6a626 85%, #ff3366 100%)';
    return (
      <div style={{ flex: 1, height: 4, background: '#111', borderRadius: 2, overflow: 'hidden', position: 'relative', border: '1px solid #000' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width 0.05s ease' }} />
      </div>
    );
  };

  const clearRecordings = () => {
    recordedFramesRef.current = [];
    setRecordedFrames([]);
  };

  const handleLiveCardClick = (sprite: AssembledSprite) => {
    const tracker = selectedTracker;
    const isCurrentlySelected = tracker && 
      Math.abs(tracker.x - sprite.x) < 25 && 
      Math.abs(tracker.y - sprite.y) < 25;
      
    if (isCurrentlySelected) {
      setSelectedTracker(null);
    } else {
      setSelectedTracker({
        x: sprite.x,
        y: sprite.y,
        width: sprite.width,
        height: sprite.height
      });
    }
  };

  if (!core) {
    return (
      <div style={{ padding: 12, color: '#666', fontSize: 10, textAlign: 'center' }}>
        No active core loaded
      </div>
    );
  }

  // Calculate dynamic card width based on columns setting (spriteScale 1 to 4)
  const padding = 12;
  const gap = 6;
  let cardWidth = 60;
  
  if (spriteScale === 4) {
    cardWidth = gridWidth - padding;
  } else if (spriteScale === 3) {
    cardWidth = Math.floor((gridWidth - padding - gap) / 2);
  } else if (spriteScale === 2) {
    cardWidth = Math.floor((gridWidth - padding - (gap * 2)) / 3);
  } else {
    cardWidth = Math.floor((gridWidth - padding - (gap * 3)) / 4);
  }
  
  cardWidth = Math.max(48, cardWidth);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Sub tabs */}
      <div style={{ display: 'flex', background: '#090918', padding: 2, borderRadius: 4, border: '1px solid #1a1a3a' }}>
        <button 
          onClick={() => setExportTab('sprites')} 
          style={{
            flex: 1, padding: '4px 8px', fontSize: 9, background: exportTab === 'sprites' ? '#1a1a3e' : 'transparent',
            border: 'none', borderRadius: 3, color: exportTab === 'sprites' ? 'var(--accent)' : '#8080a0',
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold'
          }}
        >
          SPRITES
        </button>
        <button 
          onClick={() => setExportTab('audio')} 
          style={{
            flex: 1, padding: '4px 8px', fontSize: 9, background: exportTab === 'audio' ? '#1a1a3e' : 'transparent',
            border: 'none', borderRadius: 3, color: exportTab === 'audio' ? 'var(--accent)' : '#8080a0',
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold'
          }}
        >
          AUDIO REC
        </button>
      </div>

      {exportTab === 'sprites' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, gap: 4 }}>
            <span style={{ color: '#888' }}>
              {isRecordingAnims ? `Rec [${recordedFrames.length}]` : `Sprites [${sprites.length}]`}
            </span>
            
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ color: '#666', fontSize: 8 }}>Size:</span>
                <input 
                  type="range" 
                  min={1} 
                  max={4} 
                  step={1} 
                  value={spriteScale} 
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setSpriteScale(val);
                    localStorage.setItem('retro_station_sprite_scale', String(val));
                  }} 
                  style={{ width: 35, accentColor: 'var(--accent)', cursor: 'pointer', height: 4, padding: 0 }} 
                />
                <span style={{ color: '#aaa', fontSize: 8, minWidth: 24 }}>
                  {spriteScale === 4 ? '1 Col' : spriteScale === 3 ? '2 Col' : spriteScale === 2 ? '3 Col' : '4 Col'}
                </span>
              </div>

              {/* Record Toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', color: isRecordingAnims ? '#ff3366' : '#888', fontWeight: isRecordingAnims ? 'bold' : 'normal' }}>
                <input 
                  type="checkbox" 
                  checked={isRecordingAnims} 
                  onChange={(e) => {
                    const val = e.target.checked;
                    setIsRecordingAnims(val);
                    if (val) {
                      recordedFramesRef.current = [];
                      setRecordedFrames([]);
                    }
                  }} 
                  style={{ cursor: 'pointer', margin: 0 }} 
                />
                Record
              </label>

              {isRecordingAnims && (
                <>
                  <button onClick={clearRecordings} style={{ padding: '1px 4px', fontSize: 8, background: '#3e1a1a', border: '1px solid #5e2a2a', borderRadius: 2, color: '#ff5555', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Clear
                  </button>
                  {recordedFrames.length > 0 && (
                    <button onClick={downloadRecordedSpriteSheet} style={{ padding: '1px 5px', fontSize: 8, background: '#223e1a', border: '1px solid #365e2a', borderRadius: 2, color: '#4af626', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'inherit' }} title="Download all recorded frames as a stitched horizontal spritesheet PNG">
                      Sheet ↓
                    </button>
                  )}
                </>
              )}

              {!isRecordingAnims && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', color: '#888' }}>
                    <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} style={{ cursor: 'pointer', margin: 0 }} />
                    Live
                  </label>
                  {!autoRefresh && (
                    <button onClick={refreshSprites} style={{ padding: '1px 4px', fontSize: 8, background: '#1a1a3e', border: '1px solid #2a2a5e', borderRadius: 2, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Sync
                    </button>
                  )}
                  {sprites.length > 0 && (
                    <button onClick={downloadAllSprites} style={{ padding: '1px 5px', fontSize: 8, background: '#223e1a', border: '1px solid #365e2a', borderRadius: 2, color: '#4af626', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'inherit' }}>
                      All ↓
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Render List */}
          {!isRecordingAnims ? (
            // Live Sprites view with selection capability
            sprites.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 9, border: '1px dotted #1a1a3a', borderRadius: 4, minHeight: 120 }}>
                No active sprites
              </div>
            ) : (
              <div 
                ref={gridRef}
                style={{
                  flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6,
                  border: '1px solid #1a1a3a', borderRadius: 4, padding: 6, background: '#020208',
                  alignContent: 'start'
                }}
              >
                {sprites.map((sprite, idx) => {
                  const dataUrl = sprite.canvas.toDataURL();
                  const cardInnerWidth = cardWidth - 8;
                  const innerHeightVal = cardWidth - 20;
                  const maxScaleWidth = Math.floor(cardInnerWidth / sprite.width);
                  const maxScaleHeight = Math.floor(innerHeightVal / sprite.height);
                  const currentScale = Math.max(1, Math.min(maxScaleWidth, maxScaleHeight));

                  const imgWidth = sprite.width * currentScale;
                  const imgHeight = sprite.height * currentScale;

                  // Selection highlight border checking
                  const isSelected = selectedTracker && 
                    Math.abs(selectedTracker.x - sprite.x) < 25 && 
                    Math.abs(selectedTracker.y - sprite.y) < 25;

                  return (
                    <div 
                      key={idx} 
                      className="sprite-gallery-card"
                      style={{
                        width: cardWidth,
                        background: '#090918', 
                        border: isSelected ? '2px solid #268bf6' : '1px solid #1a1a3a', 
                        borderRadius: 4, padding: isSelected ? 3 : 4,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
                        position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s ease',
                        aspectRatio: '1 / 1'
                      }}
                      onClick={() => handleLiveCardClick(sprite)}
                      title={isSelected ? "Tracked Sprite (Click to deselect)" : "Click to select and follow this sprite for Recording"}
                    >
                      <div style={{
                        width: '100%', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'repeating-conic-gradient(#000 0% 25%, #fff 0% 50%) 50% / 8px 8px',
                        borderRadius: 2, border: '1px solid #101026', marginBottom: 4, minHeight: 0
                      }}>
                        <img 
                          src={dataUrl} 
                          alt="sprite" 
                          style={{
                            imageRendering: 'pixelated',
                            width: imgWidth,
                            height: imgHeight,
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain'
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 7, color: isSelected ? '#268bf6' : '#888', fontFamily: 'inherit', padding: '0 2px' }}>
                        <span>{sprite.width}x{sprite.height}</span>
                        {isSelected && <span style={{ fontWeight: 'bold' }}>TRACK</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            // Recorded gallery view
            recordedFrames.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 9, border: '1px dotted #ff3366', borderRadius: 4, minHeight: 120, textAlign: 'center', padding: 12 }}>
                {selectedTracker 
                  ? "Tracked character is idle. Make them move/change poses in game view to record unique frames!" 
                  : "No tracker active. Select a sprite first in Live mode, or make the game run to record all unique on-screen sprites."}
              </div>
            ) : (
              <div 
                ref={gridRef}
                style={{
                  flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6,
                  border: '1px solid #ff3366', borderRadius: 4, padding: 6, background: '#020208',
                  alignContent: 'start'
                }}
              >
                {recordedFrames.map((frame, idx) => {
                  const dataUrl = frame.canvas.toDataURL();
                  const cardInnerWidth = cardWidth - 8;
                  const innerHeightVal = cardWidth - 20;
                  const maxScaleWidth = Math.floor(cardInnerWidth / frame.width);
                  const maxScaleHeight = Math.floor(innerHeightVal / frame.height);
                  const currentScale = Math.max(1, Math.min(maxScaleWidth, maxScaleHeight));

                  const imgWidth = frame.width * currentScale;
                  const imgHeight = frame.height * currentScale;

                  return (
                    <div 
                      key={frame.id || idx} 
                      className="sprite-gallery-card"
                      style={{
                        width: cardWidth,
                        background: '#090918', border: '1px solid #1a1a3a', borderRadius: 4, padding: 4,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
                        position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s ease',
                        aspectRatio: '1 / 1'
                      }}
                      onClick={() => downloadSprite(frame)}
                      title="Click to download this specific pose PNG"
                    >
                      <div style={{
                        width: '100%', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'repeating-conic-gradient(#000 0% 25%, #fff 0% 50%) 50% / 8px 8px',
                        borderRadius: 2, border: '1px solid #101026', marginBottom: 4, minHeight: 0
                      }}>
                        <img 
                          src={dataUrl} 
                          alt="sprite" 
                          style={{
                            imageRendering: 'pixelated',
                            width: imgWidth,
                            height: imgHeight,
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain'
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 7, color: '#888', fontFamily: 'inherit', padding: '0 2px' }}>
                        <span>{frame.width}x{frame.height}</span>
                        <span>#{idx + 1}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 4 }}>
          {/* Main recording visual state */}
          <div style={{
            background: '#03030f', border: '1px solid #1a1a3a', borderRadius: 4,
            padding: 12, textAlign: 'center', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 8
          }}>
            {isRecording ? (
              <>
                <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 16 }}>
                  {[...Array(4)].map((_, i) => (
                    <span key={i} style={{
                      display: 'inline-block', width: 2, height: 10, background: '#ff3366', borderRadius: 1,
                      animation: 'bounce 0.8s ease-in-out infinite',
                      animationDelay: `${i * 0.15}s`
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: 16, fontFamily: 'inherit', color: '#ff3366', fontWeight: 'bold' }}>
                  {formatDuration(recordDuration)}
                </div>
                
                {/* Real-time VU Meters */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 6, color: '#ff3366', minWidth: 6, textAlign: 'left' }}>L</span>
                    {renderVuBar(leftLevel)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 6, color: '#ff3366', minWidth: 6, textAlign: 'left' }}>R</span>
                    {renderVuBar(rightLevel)}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff3366', opacity: 0.3 }} />
                <div style={{ fontSize: 16, fontFamily: 'inherit', color: '#666' }}>
                  00:00.0
                </div>
                <span style={{ fontSize: 7, color: '#666', letterSpacing: '0.1em' }}>READY</span>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            {isRecording ? (
              <button 
                onClick={() => stopRecordingAndCleanUp(true)} 
                style={{
                  flex: 1, padding: '6px', fontSize: 9, background: '#ff3366', border: 'none',
                  borderRadius: 3, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold'
                }}
              >
                STOP & SAVE WAV
              </button>
            ) : (
              <button 
                onClick={startRecording} 
                style={{
                  flex: 1, padding: '6px', fontSize: 9, background: 'var(--accent)', border: 'none',
                  borderRadius: 3, color: '#000', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold'
                }}
              >
                START RECORDING
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * KeyMapper.tsx
 *
 * A fully self-contained, accessible key-remapping UI component.
 * It receives an `InputHandler` instance and subscribes to its mapping
 * changes — it has no dependency on the emulator core.
 *
 * Usage:
 *   <KeyMapper inputHandler={inputHandler} />
 */

import React, { useState, useEffect, useCallback } from 'react';
import { InputHandler, SNES_BUTTON, BUTTON_LABELS, DEFAULT_KEY_MAP } from 'snes-core';
import type { SnesButton } from 'snes-core';

// ─── Inline SVG icons (no package deps) ──────────────────────────────────────
const KeyIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 1.5 1.5M15.5 7.5 14 6"/>
    <circle cx="7.5" cy="16.5" r=".5"/>
  </svg>
);
const RotateCcwIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
    <polyline points="3 3 3 8 8 8"/>
  </svg>
);
const PencilIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
  </svg>
);
const CheckIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const XIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// ─── Helper: pretty-print a raw key string ────────────────────────────────────
function formatKeyLabel(key: string): string {
  const map: Record<string, string> = {
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    enter: 'Enter',
    shift: 'Shift',
    ' ': 'Space',
    escape: 'Esc',
    backspace: 'Bksp',
    tab: 'Tab',
    control: 'Ctrl',
    alt: 'Alt',
    meta: 'Meta',
    capslock: 'Caps',
  };
  return map[key] ?? key.toUpperCase();
}

// ─── Button row groupings for visual layout ───────────────────────────────────
const BUTTON_GROUPS: Array<{ label: string; buttons: SnesButton[] }> = [
  { label: 'D-Pad', buttons: ['UP', 'DOWN', 'LEFT', 'RIGHT'] },
  { label: 'Face Buttons', buttons: ['B', 'A', 'Y', 'X'] },
  { label: 'System', buttons: ['START', 'SELECT'] },
  { label: 'Shoulders', buttons: ['L', 'R'] },
];

// ─── Props ────────────────────────────────────────────────────────────────────
interface KeyMapperProps {
  inputHandler: InputHandler;
}

// ─── Component ────────────────────────────────────────────────────────────────
export const KeyMapper: React.FC<KeyMapperProps> = ({ inputHandler }) => {
  const [mapping, setMapping] = useState<Record<SnesButton, string>>(
    inputHandler.getMapping()
  );
  const [remapping, setRemapping] = useState<SnesButton | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  // Subscribe to mapping changes from outside (e.g., resetToDefaults)
  useEffect(() => {
    const unsub = inputHandler.onMappingChange((m) => setMapping({ ...m }));
    return unsub;
  }, [inputHandler]);

  // Listen for the new keypress while we are in remapping mode
  useEffect(() => {
    if (!remapping) return;

    const handleKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      let key = e.key.toLowerCase();
      if (key === 'shiftleft' || key === 'shiftright') key = 'shift';

      // Cancel on Escape
      if (key === 'escape') {
        setRemapping(null);
        setConflict(null);
        return;
      }

      // Check for conflicts with other buttons
      const current = inputHandler.getMapping();
      const conflictButton = (Object.keys(current) as SnesButton[]).find(
        (btn) => btn !== remapping && current[btn] === key
      );

      if (conflictButton) {
        setConflict(
          `Key "${formatKeyLabel(key)}" is already mapped to ${BUTTON_LABELS[conflictButton]}`
        );
        return;
      }

      inputHandler.remap(remapping, key);
      setRemapping(null);
      setConflict(null);
    };

    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [remapping, inputHandler]);

  const handleReset = useCallback(() => {
    inputHandler.resetToDefaults();
    setRemapping(null);
    setConflict(null);
  }, [inputHandler]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3
          style={{
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#cbd5e1',
            margin: 0,
          }}
        >
          <span style={{ color: '#a78bfa' }}>
            <KeyIcon size={16} />
          </span>
          Keyboard Mapping
          <span
            style={{
              fontSize: '10px',
              fontWeight: 500,
              padding: '1px 6px',
              borderRadius: '999px',
              background: 'rgba(139,92,246,0.15)',
              border: '1px solid rgba(139,92,246,0.3)',
              color: '#a78bfa',
              letterSpacing: '0.05em',
            }}
          >
            EDITABLE
          </span>
        </h3>
        <button
          onClick={handleReset}
          title="Reset to default mapping"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            fontWeight: 500,
            color: '#94a3b8',
            background: 'rgba(148,163,184,0.08)',
            border: '1px solid rgba(148,163,184,0.15)',
            borderRadius: '8px',
            padding: '4px 8px',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#e2e8f0';
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(148,163,184,0.15)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8';
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(148,163,184,0.08)';
          }}
        >
          <RotateCcwIcon size={12} />
          Defaults
        </button>
      </div>

      {/* Conflict Warning */}
      {conflict && (
        <div
          style={{
            fontSize: '11px',
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.1)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: '8px',
            padding: '6px 10px',
          }}
        >
          ⚠ {conflict}. Choose a different key.
        </div>
      )}

      {/* Button groups */}
      {BUTTON_GROUPS.map(({ label, buttons }) => (
        <div key={label}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: '#64748b',
              textTransform: 'uppercase',
              marginBottom: '6px',
            }}
          >
            {label}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px',
            }}
          >
            {buttons.map((btn) => {
              const isActive = remapping === btn;
              const keyLabel = formatKeyLabel(mapping[btn] ?? '');

              return (
                <div
                  key={btn}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 8px',
                    borderRadius: '8px',
                    background: isActive
                      ? 'rgba(139,92,246,0.15)'
                      : 'rgba(30,27,75,0.4)',
                    border: isActive
                      ? '1px solid rgba(139,92,246,0.5)'
                      : '1px solid rgba(51,65,85,0.5)',
                    transition: 'all 0.15s',
                  }}
                >
                  {/* Button name */}
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: isActive ? '#a78bfa' : '#94a3b8',
                      minWidth: '42px',
                    }}
                  >
                    {BUTTON_LABELS[btn]}
                  </span>

                  {/* Key badge + edit control */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {isActive ? (
                      <>
                        <span
                          style={{
                            fontSize: '10px',
                            color: '#a78bfa',
                            animation: 'pulse 1s infinite',
                          }}
                        >
                          Press any key…
                        </span>
                        <button
                          onClick={() => { setRemapping(null); setConflict(null); }}
                          title="Cancel"
                          style={{
                            background: 'rgba(248,113,113,0.15)',
                            border: '1px solid rgba(248,113,113,0.3)',
                            borderRadius: '4px',
                            color: '#f87171',
                            padding: '2px 4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <XIcon size={10} />
                        </button>
                      </>
                    ) : (
                      <>
                        <kbd
                          style={{
                            background: 'rgba(15,23,42,0.8)',
                            border: '1px solid rgba(71,85,105,0.6)',
                            borderRadius: '5px',
                            padding: '2px 6px',
                            fontSize: '10px',
                            fontFamily: 'inherit',
                            fontWeight: 700,
                            color: '#e2e8f0',
                            letterSpacing: '0.03em',
                            minWidth: '28px',
                            textAlign: 'center',
                          }}
                        >
                          {keyLabel}
                        </kbd>
                        <button
                          onClick={() => { setRemapping(btn); setConflict(null); }}
                          title={`Remap ${BUTTON_LABELS[btn]}`}
                          style={{
                            background: 'rgba(139,92,246,0.1)',
                            border: '1px solid rgba(139,92,246,0.25)',
                            borderRadius: '4px',
                            color: '#a78bfa',
                            padding: '3px 5px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(139,92,246,0.2)';
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(139,92,246,0.1)';
                          }}
                        >
                          <PencilIcon size={11} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Footer hint */}
      <p
        style={{
          fontSize: '10px',
          color: '#475569',
          margin: 0,
          textAlign: 'center',
        }}
      >
        Click ✏ next to any button, then press a new key. Changes save automatically.
      </p>
    </div>
  );
};

export default KeyMapper;

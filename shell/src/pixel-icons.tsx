import React from 'react';

type P = React.SVGProps<SVGSVGElement> & { size?: number };

const s: React.CSSProperties = { display: 'inline-block', flexShrink: 0, shapeRendering: 'crispEdges' };

export const PixelPlay = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="3" y="2" width="2" height="1" /><rect x="5" y="2" width="2" height="1" />
    <rect x="3" y="3" width="2" height="1" /><rect x="5" y="3" width="2" height="1" /><rect x="7" y="3" width="2" height="1" />
    <rect x="3" y="4" width="2" height="1" /><rect x="5" y="4" width="2" height="1" /><rect x="7" y="4" width="2" height="1" /><rect x="9" y="4" width="2" height="1" />
    <rect x="3" y="5" width="2" height="1" /><rect x="5" y="5" width="2" height="1" /><rect x="7" y="5" width="2" height="1" /><rect x="9" y="5" width="2" height="1" />
    <rect x="3" y="6" width="2" height="1" /><rect x="5" y="6" width="2" height="1" /><rect x="7" y="6" width="2" height="1" /><rect x="9" y="6" width="2" height="1" />
    <rect x="3" y="7" width="2" height="1" /><rect x="5" y="7" width="2" height="1" /><rect x="7" y="7" width="2" height="1" /><rect x="9" y="7" width="2" height="1" />
    <rect x="3" y="8" width="2" height="1" /><rect x="5" y="8" width="2" height="1" /><rect x="7" y="8" width="2" height="1" />
    <rect x="3" y="9" width="2" height="1" /><rect x="5" y="9" width="2" height="1" />
  </svg>
);

export const PixelPause = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="2" y="1" width="3" height="10" />
    <rect x="7" y="1" width="3" height="10" />
  </svg>
);

export const PixelRotateCcw = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <path d="M2 5h4v4" strokeLinecap="square" strokeLinejoin="miter" />
    <path d="M10 7A4 4 0 1 1 6 3" strokeLinecap="square" strokeLinejoin="miter" />
  </svg>
);

export const PixelSkipForward = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="2" y="2" width="2" height="8" />
    <rect x="4" y="2" width="2" height="1" /><rect x="6" y="2" width="2" height="1" />
    <rect x="4" y="3" width="2" height="1" /><rect x="6" y="3" width="2" height="1" />
    <rect x="4" y="4" width="2" height="1" /><rect x="6" y="4" width="2" height="1" />
    <rect x="4" y="5" width="2" height="1" /><rect x="6" y="5" width="2" height="1" />
    <rect x="4" y="6" width="2" height="1" /><rect x="6" y="6" width="2" height="1" />
    <rect x="4" y="7" width="2" height="1" /><rect x="6" y="7" width="2" height="1" />
    <rect x="4" y="8" width="2" height="1" /><rect x="6" y="8" width="2" height="1" />
  </svg>
);

export const PixelSettings = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <circle cx="6" cy="6" r="2" strokeLinecap="square" />
    <path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.3 2.3l.7.7M9 9l.7.7M2.3 9.7l.7-.7M9 3l.7-.7" strokeLinecap="square" />
  </svg>
);

export const PixelX = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <path d="M2 2l8 8M10 2l-8 8" strokeLinecap="square" />
  </svg>
);

export const PixelCheck = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <path d="M2 6l3 3 5-5" strokeLinecap="square" strokeLinejoin="miter" />
  </svg>
);

export const PixelPanelLeft = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="1" y="2" width="10" height="8" strokeLinecap="square" />
    <line x1="4" y1="2" x2="4" y2="10" strokeLinecap="square" />
  </svg>
);

export const PixelPanelRight = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="1" y="2" width="10" height="8" strokeLinecap="square" />
    <line x1="8" y1="2" x2="8" y2="10" strokeLinecap="square" />
  </svg>
);

export const PixelUpload = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <path d="M6 1v6M3 4l3-3 3 3" strokeLinecap="square" strokeLinejoin="miter" />
    <line x1="2" y1="9" x2="10" y2="9" strokeLinecap="square" />
    <line x1="2" y1="10" x2="10" y2="10" strokeLinecap="square" />
  </svg>
);

export const PixelMaximize = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="2" y="2" width="8" height="8" strokeLinecap="square" />
    <line x1="2" y1="5" x2="10" y2="5" strokeLinecap="square" />
  </svg>
);

export const PixelMinimize = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="2" y="2" width="8" height="8" strokeLinecap="square" />
    <line x1="2" y1="5" x2="10" y2="5" strokeLinecap="square" />
    <rect x="4" y="7" width="4" height="2" fill="currentColor" />
  </svg>
);

export const PixelCpu = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="3" y="3" width="6" height="6" strokeLinecap="square" />
    <line x1="5" y1="1" x2="5" y2="3" strokeLinecap="square" />
    <line x1="7" y1="1" x2="7" y2="3" strokeLinecap="square" />
    <line x1="5" y1="9" x2="5" y2="11" strokeLinecap="square" />
    <line x1="7" y1="9" x2="7" y2="11" strokeLinecap="square" />
    <line x1="1" y1="5" x2="3" y2="5" strokeLinecap="square" />
    <line x1="1" y1="7" x2="3" y2="7" strokeLinecap="square" />
    <line x1="9" y1="5" x2="11" y2="5" strokeLinecap="square" />
    <line x1="9" y1="7" x2="11" y2="7" strokeLinecap="square" />
  </svg>
);

export const PixelMonitor = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <rect x="1" y="1" width="10" height="7" strokeLinecap="square" />
    <line x1="3" y1="8" x2="9" y2="8" strokeLinecap="square" />
    <line x1="5" y1="8" x2="5" y2="11" strokeLinecap="square" />
    <line x1="3" y1="11" x2="7" y2="11" strokeLinecap="square" />
  </svg>
);

export const PixelRefreshCw = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <path d="M2 5h4v4" strokeLinecap="square" strokeLinejoin="miter" />
    <path d="M10 5A4 4 0 1 0 9 8" strokeLinecap="square" strokeLinejoin="miter" />
  </svg>
);

export const PixelAlertCircle = ({ size = 12, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ ...s, ...(rest.style || {}) }} {...rest}>
    <circle cx="6" cy="6" r="5" strokeLinecap="square" />
    <line x1="6" y1="3" x2="6" y2="6" strokeLinecap="square" />
    <line x1="6" y1="8" x2="6" y2="9" strokeLinecap="square" />
  </svg>
);

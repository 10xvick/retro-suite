import { describe, it, expect } from 'vitest';
import { runVisualVideoTestSuite } from './run_visual_video_test_suite.js';

describe('GBA Core Visual Video Test Suite & Screenshot Parity', () => {
  it('Captures screenshots and validates 100% pixel parity across all 7 video subtests', () => {
    const report = runVisualVideoTestSuite();
    expect(report.totalPassed).toBe(report.total);
  }, 300000);
});

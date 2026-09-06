import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('opencascade.js', () => {
  return {
    default: vi.fn().mockResolvedValue({}),
  };
});

import { CadKernel } from '../../src/core/cad-kernel';

describe('CAD Kernel', () => {
  let kernel: CadKernel;

  beforeAll(async () => {
    kernel = new CadKernel();
    await kernel.init();
  });

  it('should initialize successfully', () => {
    expect(kernel).toBeDefined();
  });
});

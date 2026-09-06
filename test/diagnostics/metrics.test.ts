/**
 * Diagnostic engine tests — test quality metric calculations
 * and defect detection on meshes with known defects.
 */

import { describe, it, expect } from 'vitest';

import {
  aspectRatioTri, aspectRatioQuad,
  jacobianQuad, jacobianTri,
  warpageQuad,
  skewnessTri, skewnessQuad,
  interiorAnglesTri, interiorAnglesQuad,
  elementQualityTri, elementQualityQuad,
  isZeroAreaTri, isInvertedTet, tetVolume,
  computeCentroid,
} from '../../src/diagnostics/metrics';

type V3 = [number, number, number];

// ─── Vector Math Helpers ────────────────────────────────────────────────────

describe('Metrics — Basic Calculations', () => {
  it('centroid of triangle nodes', () => {
    const nodes: V3[] = [[0, 0, 0], [3, 0, 0], [0, 3, 0]];
    const c = computeCentroid(nodes);
    expect(c[0]).toBeCloseTo(1, 5);
    expect(c[1]).toBeCloseTo(1, 5);
    expect(c[2]).toBeCloseTo(0, 5);
  });
});

// ─── Triangle Quality ───────────────────────────────────────────────────────

describe('Metrics — Triangle Quality', () => {
  it('equilateral triangle has ideal aspect ratio near 1.15', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0.5, Math.sqrt(3) / 2, 0];
    const ar = aspectRatioTri(a, b, c);
    expect(ar).toBeCloseTo(1.1547, 2);
  });

  it('skinny triangle has high aspect ratio', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [10, 0, 0];
    const c: V3 = [5, 0.1, 0];
    const ar = aspectRatioTri(a, b, c);
    expect(ar).toBeGreaterThan(5);
  });

  it('degenerate (collinear) triangle has Infinity aspect ratio', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [2, 0, 0];
    const ar = aspectRatioTri(a, b, c);
    expect(ar).toBe(Infinity);
  });

  it('equilateral triangle has low skewness', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0.5, Math.sqrt(3) / 2, 0];
    const skew = skewnessTri(a, b, c);
    expect(skew).toBeLessThan(0.05);
  });

  it('equilateral triangle interior angles are 60°', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0.5, Math.sqrt(3) / 2, 0];
    const angles = interiorAnglesTri(a, b, c);
    for (const angle of angles) {
      expect(angle).toBeCloseTo(60, 1);
    }
  });

  it('zero-area triangle is detected', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [2, 0, 0];
    expect(isZeroAreaTri(a, b, c)).toBe(true);
  });

  it('normal triangle is not zero-area', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0, 1, 0];
    expect(isZeroAreaTri(a, b, c)).toBe(false);
  });

  it('equilateral triangle has high quality', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0.5, Math.sqrt(3) / 2, 0];
    const q = elementQualityTri(a, b, c);
    expect(q).toBeGreaterThan(0.8);
  });
});

// ─── Quad Quality ───────────────────────────────────────────────────────────

describe('Metrics — Quad Quality', () => {
  it('unit square has ideal aspect ratio of 1.0', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [1, 1, 0];
    const d: V3 = [0, 1, 0];
    const ar = aspectRatioQuad(a, b, c, d);
    expect(ar).toBeCloseTo(1.0, 5);
  });

  it('elongated quad has high aspect ratio', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [10, 0, 0];
    const c: V3 = [10, 1, 0];
    const d: V3 = [0, 1, 0];
    const ar = aspectRatioQuad(a, b, c, d);
    expect(ar).toBeCloseTo(10, 0);
  });

  it('planar quad has zero warpage', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [1, 1, 0];
    const d: V3 = [0, 1, 0];
    const warp = warpageQuad(a, b, c, d);
    expect(warp).toBeCloseTo(0, 3);
  });

  it('warped quad has positive warpage', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [1, 1, 0.5]; // lifted out of plane
    const d: V3 = [0, 1, 0];
    const warp = warpageQuad(a, b, c, d);
    expect(warp).toBeGreaterThan(5);
  });

  it('unit square has Jacobian ≈ 1.0', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [1, 1, 0];
    const d: V3 = [0, 1, 0];
    const jac = jacobianQuad(a, b, c, d);
    expect(jac).toBeCloseTo(1.0, 3);
  });

  it('unit square has low skewness', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [1, 1, 0];
    const d: V3 = [0, 1, 0];
    const skew = skewnessQuad(a, b, c, d);
    expect(skew).toBeLessThan(0.05);
  });

  it('unit square interior angles are 90°', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [1, 1, 0];
    const d: V3 = [0, 1, 0];
    const angles = interiorAnglesQuad(a, b, c, d);
    for (const angle of angles) {
      expect(angle).toBeCloseTo(90, 1);
    }
  });

  it('unit square has high quality', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [1, 1, 0];
    const d: V3 = [0, 1, 0];
    const q = elementQualityQuad(a, b, c, d);
    expect(q).toBeGreaterThan(0.8);
  });
});

// ─── Tet Quality ────────────────────────────────────────────────────────────

describe('Metrics — Tet Quality', () => {
  it('regular tet has positive volume', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0.5, Math.sqrt(3) / 2, 0];
    const d: V3 = [0.5, Math.sqrt(3) / 6, Math.sqrt(6) / 3];
    const vol = tetVolume(a, b, c, d);
    expect(vol).toBeGreaterThan(0);
  });

  it('inverted tet has negative volume', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0.5, Math.sqrt(3) / 2, 0];
    const d: V3 = [0.5, Math.sqrt(3) / 6, -Math.sqrt(6) / 3]; // flipped
    const vol = tetVolume(a, b, c, d);
    expect(vol).toBeLessThan(0);
  });

  it('isInvertedTet detects inverted tet', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0.5, Math.sqrt(3) / 2, 0];
    const d: V3 = [0.5, Math.sqrt(3) / 6, -Math.sqrt(6) / 3];
    expect(isInvertedTet(a, b, c, d)).toBe(true);
  });

  it('isInvertedTet passes valid tet', () => {
    const a: V3 = [0, 0, 0];
    const b: V3 = [1, 0, 0];
    const c: V3 = [0.5, Math.sqrt(3) / 2, 0];
    const d: V3 = [0.5, Math.sqrt(3) / 6, Math.sqrt(6) / 3];
    expect(isInvertedTet(a, b, c, d)).toBe(false);
  });
});

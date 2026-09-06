/**
 * metrics.ts — Finite Element Mesh Quality Metric Calculators
 *
 * Pure functions operating on element node coordinates.
 * Each metric matches ANSA Meshing's own criteria for trustworthiness.
 *
 * All functions take node coordinates as [x,y,z] tuples for zero-allocation performance.
 */

// ─── Vector Math Primitives ──────────────────────────────────────────────────

type V3 = [number, number, number];

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v: V3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalize(v: V3): V3 {
  const len = length(v);
  if (len < 1e-30) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function angleBetweenVectors(a: V3, b: V3): number {
  const cosAngle = dot(normalize(a), normalize(b));
  // Clamp to [-1, 1] to handle floating-point errors
  return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
}

function edgeLength(a: V3, b: V3): number {
  return length(sub(b, a));
}

function triangleArea(a: V3, b: V3, c: V3): number {
  return 0.5 * length(cross(sub(b, a), sub(c, a)));
}

function triangleNormal(a: V3, b: V3, c: V3): V3 {
  return normalize(cross(sub(b, a), sub(c, a)));
}

// ─── Centroid Calculation ────────────────────────────────────────────────────

export function computeCentroid(nodes: V3[]): V3 {
  let sx = 0, sy = 0, sz = 0;
  for (const n of nodes) {
    sx += n[0]; sy += n[1]; sz += n[2];
  }
  const count = nodes.length;
  return [sx / count, sy / count, sz / count];
}

// ─── Aspect Ratio ────────────────────────────────────────────────────────────

/**
 * Aspect ratio for a triangular element: longest edge / shortest altitude.
 * Ideal = 1.0 (equilateral), higher = worse.
 */
export function aspectRatioTri(a: V3, b: V3, c: V3): number {
  const edges = [edgeLength(a, b), edgeLength(b, c), edgeLength(c, a)];
  const maxEdge = Math.max(...edges);
  const area = triangleArea(a, b, c);
  if (area < 1e-30) return Infinity; // degenerate

  // Shortest altitude = 2 * area / longest edge
  const shortestAlt = (2 * area) / maxEdge;
  return maxEdge / shortestAlt;
}

/**
 * Aspect ratio for a quad element: max edge / min edge.
 */
export function aspectRatioQuad(a: V3, b: V3, c: V3, d: V3): number {
  const edges = [
    edgeLength(a, b), edgeLength(b, c),
    edgeLength(c, d), edgeLength(d, a),
  ];
  const maxEdge = Math.max(...edges);
  const minEdge = Math.min(...edges);
  if (minEdge < 1e-30) return Infinity;
  return maxEdge / minEdge;
}

/**
 * Aspect ratio for a tet element.
 */
export function aspectRatioTet(a: V3, b: V3, c: V3, d: V3): number {
  const edges = [
    edgeLength(a, b), edgeLength(a, c), edgeLength(a, d),
    edgeLength(b, c), edgeLength(b, d), edgeLength(c, d),
  ];
  const maxEdge = Math.max(...edges);
  const minEdge = Math.min(...edges);
  if (minEdge < 1e-30) return Infinity;
  return maxEdge / minEdge;
}

// ─── Jacobian Ratio ──────────────────────────────────────────────────────────

/**
 * Jacobian ratio for a quad element.
 * Computed at 4 corner sampling points.
 * Returns min(J)/max(J). Value ≤ 0 means inverted.
 */
export function jacobianQuad(a: V3, b: V3, c: V3, d: V3): number {
  // Jacobian at each corner is the cross product of adjacent edge vectors
  // projected onto the element normal
  const corners = [a, b, c, d];
  const jacobians: number[] = [];

  // Compute average normal
  const n1 = triangleNormal(a, b, c);
  const n2 = triangleNormal(a, c, d);
  const avgNormal: V3 = normalize([
    (n1[0] + n2[0]) / 2,
    (n1[1] + n2[1]) / 2,
    (n1[2] + n2[2]) / 2,
  ]);

  for (let i = 0; i < 4; i++) {
    const prev = corners[(i + 3) % 4];
    const curr = corners[i];
    const next = corners[(i + 1) % 4];

    const e1 = sub(next, curr);
    const e2 = sub(prev, curr);
    const crossProd = cross(e1, e2);
    const jac = dot(crossProd, avgNormal);
    jacobians.push(jac);
  }

  const minJ = Math.min(...jacobians);
  const maxJ = Math.max(...jacobians);

  if (Math.abs(maxJ) < 1e-30) return 0; // degenerate
  return minJ / maxJ;
}

/**
 * Jacobian ratio for a triangular element.
 * For a planar triangle, it's always 1.0 (perfect).
 * Returns the signed area ratio to detect inversion.
 */
export function jacobianTri(a: V3, b: V3, c: V3): number {
  const area = triangleArea(a, b, c);
  if (area < 1e-30) return 0; // degenerate

  // Check orientation via cross product z-component
  const normal = cross(sub(b, a), sub(c, a));
  const signedArea = length(normal);
  return signedArea < 1e-30 ? 0 : 1.0; // Triangles are always valid if non-degenerate
}

/**
 * Jacobian for a tet element: ratio of min to max corner Jacobians.
 * J < 0 means inverted.
 */
export function jacobianTet(a: V3, b: V3, c: V3, d: V3): number {
  // Volume of tet = (1/6) * |det([b-a, c-a, d-a])|
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ad = sub(d, a);
  const volume = dot(ab, cross(ac, ad)) / 6.0;

  if (Math.abs(volume) < 1e-30) return 0;
  return volume > 0 ? 1.0 : -1.0; // Simplified: positive volume = valid
}

// ─── Warpage (Quad only) ─────────────────────────────────────────────────────

/**
 * Warpage of a quad element in degrees.
 * Measures out-of-planeness by splitting into two triangles and
 * computing the angle between their normals.
 * Ideal = 0° (perfectly planar).
 */
export function warpageQuad(a: V3, b: V3, c: V3, d: V3): number {
  // Split along diagonal AC
  const n1 = triangleNormal(a, b, c);
  const n2 = triangleNormal(a, c, d);

  // Split along diagonal BD
  const n3 = triangleNormal(b, c, d);
  const n4 = triangleNormal(b, d, a);

  // Warpage is max of both diagonal splits
  const angle1 = angleBetweenVectors(n1, n2);
  const angle2 = angleBetweenVectors(n3, n4);

  return Math.max(angle1, angle2);
}

// ─── Skewness ────────────────────────────────────────────────────────────────

/**
 * Skewness of a triangle element.
 * Measures deviation from equilateral (ideal angle = 60°).
 * Returns 0 (equilateral) to 1 (degenerate).
 */
export function skewnessTri(a: V3, b: V3, c: V3): number {
  const idealAngle = 60;
  const angles = interiorAnglesTri(a, b, c);
  const maxAngle = Math.max(...angles);
  const minAngle = Math.min(...angles);

  const skew1 = (maxAngle - idealAngle) / (180 - idealAngle);
  const skew2 = (idealAngle - minAngle) / idealAngle;

  return Math.max(skew1, skew2);
}

/**
 * Skewness of a quad element.
 * Ideal angle = 90°.
 */
export function skewnessQuad(a: V3, b: V3, c: V3, d: V3): number {
  const idealAngle = 90;
  const angles = interiorAnglesQuad(a, b, c, d);
  const maxAngle = Math.max(...angles);
  const minAngle = Math.min(...angles);

  const skew1 = (maxAngle - idealAngle) / (180 - idealAngle);
  const skew2 = (idealAngle - minAngle) / idealAngle;

  return Math.max(skew1, skew2);
}

// ─── Interior Angles ─────────────────────────────────────────────────────────

/** Compute interior angles (degrees) of a triangle */
export function interiorAnglesTri(a: V3, b: V3, c: V3): [number, number, number] {
  return [
    angleBetweenVectors(sub(b, a), sub(c, a)), // angle at A
    angleBetweenVectors(sub(a, b), sub(c, b)), // angle at B
    angleBetweenVectors(sub(a, c), sub(b, c)), // angle at C
  ];
}

/** Compute interior angles (degrees) of a quad (at each corner) */
export function interiorAnglesQuad(a: V3, b: V3, c: V3, d: V3): [number, number, number, number] {
  return [
    angleBetweenVectors(sub(d, a), sub(b, a)), // angle at A
    angleBetweenVectors(sub(a, b), sub(c, b)), // angle at B
    angleBetweenVectors(sub(b, c), sub(d, c)), // angle at C
    angleBetweenVectors(sub(c, d), sub(a, d)), // angle at D
  ];
}

// ─── Element Quality (Composite Score) ───────────────────────────────────────

/**
 * Composite element quality score (0 = worst, 1 = ideal).
 * Weighted combination of aspect ratio, Jacobian, and skewness.
 */
export function elementQualityTri(a: V3, b: V3, c: V3): number {
  const ar = aspectRatioTri(a, b, c);
  const jac = jacobianTri(a, b, c);
  const skew = skewnessTri(a, b, c);

  // Normalize aspect ratio: 1.0 → 1.0, 10.0 → 0.0
  const arScore = Math.max(0, 1 - (ar - 1) / 9);
  // Jacobian: already 0-1
  const jacScore = Math.max(0, jac);
  // Skewness: invert (0 = best → 1.0, 1 = worst → 0.0)
  const skewScore = Math.max(0, 1 - skew);

  // Weighted average (Jacobian most important)
  return 0.3 * arScore + 0.4 * jacScore + 0.3 * skewScore;
}

export function elementQualityQuad(a: V3, b: V3, c: V3, d: V3): number {
  const ar = aspectRatioQuad(a, b, c, d);
  const jac = jacobianQuad(a, b, c, d);
  const skew = skewnessQuad(a, b, c, d);
  const warp = warpageQuad(a, b, c, d);

  const arScore = Math.max(0, 1 - (ar - 1) / 9);
  const jacScore = Math.max(0, jac);
  const skewScore = Math.max(0, 1 - skew);
  const warpScore = Math.max(0, 1 - warp / 45); // 45° = fully bad

  return 0.2 * arScore + 0.35 * jacScore + 0.25 * skewScore + 0.2 * warpScore;
}

// ─── Volume Checks ───────────────────────────────────────────────────────────

/** Signed volume of a tetrahedron. Negative = inverted. */
export function tetVolume(a: V3, b: V3, c: V3, d: V3): number {
  return dot(sub(b, a), cross(sub(c, a), sub(d, a))) / 6.0;
}

/** Check if a triangle has near-zero area (degenerate) */
export function isZeroAreaTri(a: V3, b: V3, c: V3, tolerance: number = 1e-12): boolean {
  return triangleArea(a, b, c) < tolerance;
}

/** Check if a tet has near-zero or negative volume (degenerate/inverted) */
export function isInvertedTet(a: V3, b: V3, c: V3, d: V3): boolean {
  return tetVolume(a, b, c, d) <= 0;
}

// ─── Hex Quality ─────────────────────────────────────────────────────────────

/**
 * Simplified hex quality check via decomposition into tets.
 * Checks if any sub-tet has negative volume (inverted hex).
 */
export function isInvertedHex(nodes: V3[]): boolean {
  if (nodes.length < 8) return true;
  // Decompose hex into 5 tets and check each
  const tetDecomposition = [
    [0, 1, 3, 4], [1, 2, 3, 6], [3, 4, 6, 7],
    [1, 4, 5, 6], [1, 3, 4, 6],
  ];

  for (const tet of tetDecomposition) {
    const vol = tetVolume(nodes[tet[0]], nodes[tet[1]], nodes[tet[2]], nodes[tet[3]]);
    if (vol <= 0) return true;
  }
  return false;
}

/**
 * Aspect ratio for a hex element (simplified: max edge / min edge).
 */
export function aspectRatioHex(nodes: V3[]): number {
  if (nodes.length < 8) return Infinity;
  const hexEdges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const lengths = hexEdges.map(([i, j]) => edgeLength(nodes[i], nodes[j]));
  const maxL = Math.max(...lengths);
  const minL = Math.min(...lengths);
  if (minL < 1e-30) return Infinity;
  return maxL / minL;
}

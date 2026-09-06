/**
 * defect-record.ts — Defect type definitions
 *
 * The contract between the diagnostic engine and the AI agent.
 * Every defect produces a structured record that the agent consumes.
 */

// ─── Defect Types ────────────────────────────────────────────────────────────

export enum DefectType {
  // Element quality metrics
  ASPECT_RATIO = 'ASPECT_RATIO',
  JACOBIAN = 'JACOBIAN',
  WARPAGE = 'WARPAGE',
  SKEWNESS = 'SKEWNESS',
  MIN_ANGLE = 'MIN_ANGLE',
  MAX_ANGLE = 'MAX_ANGLE',
  ELEMENT_QUALITY = 'ELEMENT_QUALITY',

  // Topology errors
  DUPLICATE_NODES = 'DUPLICATE_NODES',
  FREE_EDGES = 'FREE_EDGES',
  NON_MANIFOLD_EDGE = 'NON_MANIFOLD_EDGE',
  NON_MANIFOLD_VERTEX = 'NON_MANIFOLD_VERTEX',
  INVERTED_ELEMENT = 'INVERTED_ELEMENT',
  ZERO_AREA_ELEMENT = 'ZERO_AREA_ELEMENT',
  UNREFERENCED_NODES = 'UNREFERENCED_NODES',
  SELF_INTERSECTION = 'SELF_INTERSECTION',

  // CAD conformance (Phase 2)
  CAD_DEVIATION = 'CAD_DEVIATION',
}

// ─── Severity Scale ──────────────────────────────────────────────────────────

/**
 * Severity 1 = info/minor (e.g., slightly suboptimal aspect ratio)
 * Severity 2 = warning (e.g., element nearing quality threshold)
 * Severity 3 = significant (e.g., failed quality check, should be fixed)
 * Severity 4 = critical (e.g., inverted element, will cause solver failure)
 * Severity 5 = fatal (e.g., mesh is unusable without fix)
 */
export type Severity = 1 | 2 | 3 | 4 | 5;

// ─── Fix Strategies ──────────────────────────────────────────────────────────

export enum FixStrategy {
  /** Snap nodes back to the nearest CAD surface/curve */
  PROJECT_TO_CAD = 'PROJECT_TO_CAD',
  /** Regenerate mesh in a local patch */
  LOCAL_REMESH = 'LOCAL_REMESH',
  /** Collapse or split a degenerate/inverted element */
  COLLAPSE_OR_SPLIT = 'COLLAPSE_OR_SPLIT',
  /** Laplacian smoothing to improve quality without topology change */
  LAPLACIAN_SMOOTH = 'LAPLACIAN_SMOOTH',
  /** Merge duplicate nodes within tolerance */
  DEDUPLICATE_NODES = 'DEDUPLICATE_NODES',
  /** Delete unreferenced nodes */
  REMOVE_UNREFERENCED = 'REMOVE_UNREFERENCED',
  /** Flip element connectivity to fix inversion */
  FLIP_NORMALS = 'FLIP_NORMALS',
  /** Requires manual review — no automated fix available */
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

// ─── Defect Record ───────────────────────────────────────────────────────────

export interface DefectRecord {
  /** Unique defect identifier */
  id: string;
  /** Defect classification */
  type: DefectType;
  /** Severity level (1=info, 5=fatal) */
  severity: Severity;
  /** Affected element IDs */
  elementIds: number[];
  /** Affected node IDs */
  nodeIds: number[];
  /** Representative 3D location for camera navigation */
  location: { x: number; y: number; z: number };
  /** The computed metric value that triggered this defect */
  metricValue: number;
  /** The threshold that was exceeded */
  threshold: number;
  /** Recommended fix strategy */
  suggestedFixStrategy: FixStrategy;
  /** Human-readable description */
  description: string;
  /** Component/part name where the defect was found */
  componentName?: string;
}

// ─── Quality Thresholds ──────────────────────────────────────────────────────

/** User-configurable quality thresholds matching ANSA defaults */
export interface QualityThresholds {
  maxAspectRatio: number;        // ANSA default: 5.0 (warn), 10.0 (fail)
  minJacobian: number;           // ANSA default: 0.3 (fail if below)
  maxWarpage: number;            // ANSA default: 15° (warn), 30° (fail)
  maxSkewness: number;           // ANSA default: 0.7 (warn), 0.9 (fail)
  minAngleTri: number;           // ANSA default: 20° (fail if below)
  maxAngleTri: number;           // ANSA default: 120° (fail if above)
  minAngleQuad: number;          // ANSA default: 30° (fail if below)
  maxAngleQuad: number;          // ANSA default: 150° (fail if above)
  minElementQuality: number;     // Composite: 0.0–1.0, default 0.3
  duplicateNodeTolerance: number; // Distance threshold for duplicate detection: 1e-6
  cadDeviationTolerance: number; // Maximum allowed distance from mesh node to CAD surface
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  maxAspectRatio: 20.0,
  minJacobian: 0.0,
  maxWarpage: 30.0,
  maxSkewness: 0.9,
  minAngleTri: 20.0,
  maxAngleTri: 120.0,
  minAngleQuad: 30.0,
  maxAngleQuad: 150.0,
  minElementQuality: 0.2,
  duplicateNodeTolerance: 1e-6,
  cadDeviationTolerance: 0.1,
};

// ─── Diagnostic Summary ──────────────────────────────────────────────────────

export interface DiagnosticSummary {
  totalElements: number;
  totalNodes: number;
  totalDefects: number;
  defectsBySeverity: Record<number, number>;
  defectsByType: Record<string, number>;
  overallQualityScore: number; // 0–100
  timestamp: string;
}

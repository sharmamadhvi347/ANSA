/**
 * mesh-renderer.ts — Converts MeshModel into Three.js-ready buffers
 *
 * Bridges the canonical mesh model to the 3D viewport by generating
 * triangle indices, wireframe line indices, and defect highlight geometry.
 */

import { MeshModel, MeshElement } from '../core/mesh-model';
import { ElementShape, getTopology, ElementDimension, getCornerEdges } from '../core/element-types';
import { DefectRecord } from '../diagnostics/defect-record';

// ─── Buffer Generation ──────────────────────────────────────────────────────

export interface MeshBuffers {
  /** Flat vertex positions [x,y,z,...] for all nodes */
  positions: Float32Array;
  /** Flat vertex colors [r,g,b,...] for heatmap overlay (optional) */
  colors?: Float32Array;
  /** Triangle indices into positions array (for solid rendering) */
  triangleIndices: Uint32Array;
  /** Line indices into positions array (for wireframe) */
  wireframeIndices: Uint32Array;
  /** Mapping: internal buffer index → original node ID */
  indexToNodeId: number[];
  /** Reverse mapping: original node ID → buffer index */
  nodeIdToIndex: Map<number, number>;
}

/**
 * Convert a MeshModel into GPU-ready buffers for Three.js rendering.
 */
export function generateMeshBuffers(model: MeshModel): MeshBuffers {
  // Build node ID → buffer index mapping
  const nodeIds = model.nodes.ids;
  const nodeIdToIndex = new Map<number, number>();
  const indexToNodeId: number[] = [];

  for (let i = 0; i < nodeIds.length; i++) {
    nodeIdToIndex.set(nodeIds[i], i);
    indexToNodeId.push(nodeIds[i]);
  }

  // Fill positions
  const positions = new Float32Array(nodeIds.length * 3);
  for (let i = 0; i < nodeIds.length; i++) {
    const xyz = model.nodes.getXYZ(nodeIds[i]);
    if (xyz) {
      positions[i * 3] = xyz[0];
      positions[i * 3 + 1] = xyz[1];
      positions[i * 3 + 2] = xyz[2];
    }
  }

  // Build triangle indices and wireframe indices
  const triangles: number[] = [];
  const wireLines: number[] = [];

  for (const elem of model.elements) {
    const topo = getTopology(elem.shape);

    // Triangulate element for solid rendering
    const triIndices = triangulateElement(elem, nodeIdToIndex);
    triangles.push(...triIndices);

    // Wireframe edges (corner edges only)
    const cornerEdges = getCornerEdges(elem.shape);
    for (const [localA, localB] of cornerEdges) {
      const idA = elem.nodeIds[localA];
      const idB = elem.nodeIds[localB];
      if (idA === undefined || idB === undefined) continue;
      const bufA = nodeIdToIndex.get(idA);
      const bufB = nodeIdToIndex.get(idB);
      if (bufA !== undefined && bufB !== undefined) {
        wireLines.push(bufA, bufB);
      }
    }
  }

  return {
    positions,
    triangleIndices: new Uint32Array(triangles),
    wireframeIndices: new Uint32Array(wireLines),
    indexToNodeId,
    nodeIdToIndex,
  };
}

/**
 * Triangulate a single element into triangle indices (buffer indices).
 * Handles tri, quad, tet, hex, wedge by decomposing into triangles.
 */
function triangulateElement(elem: MeshElement, nodeIdToIndex: Map<number, number>): number[] {
  const indices: number[] = [];
  const nodeIds = elem.nodeIds;

  const getIdx = (localIdx: number): number | undefined => {
    const nid = nodeIds[localIdx];
    return nid !== undefined ? nodeIdToIndex.get(nid) : undefined;
  };

  switch (elem.shape) {
    case ElementShape.TRI3:
    case ElementShape.TRI6: {
      const a = getIdx(0), b = getIdx(1), c = getIdx(2);
      if (a !== undefined && b !== undefined && c !== undefined) {
        indices.push(a, b, c);
      }
      break;
    }

    case ElementShape.QUAD4:
    case ElementShape.QUAD8: {
      const a = getIdx(0), b = getIdx(1), c = getIdx(2), d = getIdx(3);
      if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
        indices.push(a, b, c);
        indices.push(a, c, d);
      }
      break;
    }

    case ElementShape.TET4:
    case ElementShape.TET10: {
      // 4 faces, each a triangle
      const faces = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
      for (const face of faces) {
        const a = getIdx(face[0]), b = getIdx(face[1]), c = getIdx(face[2]);
        if (a !== undefined && b !== undefined && c !== undefined) {
          indices.push(a, b, c);
        }
      }
      break;
    }

    case ElementShape.HEX8:
    case ElementShape.HEX20: {
      // 6 faces, each a quad → 2 triangles
      const faces = [
        [0, 1, 2, 3], [4, 7, 6, 5],
        [0, 4, 5, 1], [1, 5, 6, 2],
        [2, 6, 7, 3], [3, 7, 4, 0],
      ];
      for (const face of faces) {
        const a = getIdx(face[0]), b = getIdx(face[1]);
        const c = getIdx(face[2]), d = getIdx(face[3]);
        if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
          indices.push(a, b, c);
          indices.push(a, c, d);
        }
      }
      break;
    }

    case ElementShape.WEDGE6:
    case ElementShape.WEDGE15: {
      // 2 tri faces + 3 quad faces
      const triFaces = [[0, 1, 2], [3, 5, 4]];
      const quadFaces = [[0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]];
      for (const face of triFaces) {
        const a = getIdx(face[0]), b = getIdx(face[1]), c = getIdx(face[2]);
        if (a !== undefined && b !== undefined && c !== undefined) {
          indices.push(a, b, c);
        }
      }
      for (const face of quadFaces) {
        const a = getIdx(face[0]), b = getIdx(face[1]);
        const c = getIdx(face[2]), d = getIdx(face[3]);
        if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
          indices.push(a, b, c);
          indices.push(a, c, d);
        }
      }
      break;
    }
  }

  return indices;
}

// ─── Defect Highlight Geometry ───────────────────────────────────────────────

export interface DefectHighlight {
  positions: Float32Array;
  indices: Uint32Array;
  severity: number;
  defectId: string;
}

/**
 * Generate highlight geometry for a set of defects.
 * Each defective element gets its own highlight mesh with severity-coded color.
 */
export function generateDefectHighlights(
  model: MeshModel,
  defects: DefectRecord[],
  meshBuffers: MeshBuffers,
): DefectHighlight[] {
  const highlights: DefectHighlight[] = [];

  // Group defects by element
  const elemDefects = new Map<number, { maxSeverity: number; defectId: string }>();
  for (const defect of defects) {
    for (const elemId of defect.elementIds) {
      const existing = elemDefects.get(elemId);
      if (!existing || defect.severity > existing.maxSeverity) {
        elemDefects.set(elemId, { maxSeverity: defect.severity, defectId: defect.id });
      }
    }
  }

  // Group elements by severity for batching
  const severityGroups = new Map<number, number[]>();
  for (const [elemId, info] of elemDefects) {
    const group = severityGroups.get(info.maxSeverity);
    if (group) {
      group.push(elemId);
    } else {
      severityGroups.set(info.maxSeverity, [elemId]);
    }
  }

  // Generate geometry for each severity group
  for (const [severity, elemIds] of severityGroups) {
    const triIndices: number[] = [];

    for (const elemId of elemIds) {
      const elem = model.elements.getElement(elemId);
      if (!elem) continue;

      const indices = triangulateElement(elem, meshBuffers.nodeIdToIndex);
      triIndices.push(...indices);
    }

    if (triIndices.length > 0) {
      highlights.push({
        positions: meshBuffers.positions, // Share the same position buffer
        indices: new Uint32Array(triIndices),
        severity,
        defectId: `severity-${severity}`,
      });
    }
  }

  return highlights;
}

// ─── CAD Deviation Heatmap ───────────────────────────────────────────────────

export function applyDeviationHeatmap(
  meshBuffers: MeshBuffers,
  defects: DefectRecord[],
  maxExpectedDeviation: number = 2.0
): void {
  const numNodes = meshBuffers.positions.length / 3;
  const colors = new Float32Array(numNodes * 3);
  
  // Default color (gray/blue) for all nodes
  for (let i = 0; i < numNodes; i++) {
    colors[i * 3] = 0.2;     // R
    colors[i * 3 + 1] = 0.5; // G
    colors[i * 3 + 2] = 0.8; // B
  }

  // Filter CAD deviation defects
  const cadDefects = defects.filter(d => d.type === 'CAD_DEVIATION');
  
  for (const defect of cadDefects) {
    for (const nid of defect.nodeIds) {
      const idx = meshBuffers.nodeIdToIndex.get(nid);
      if (idx !== undefined) {
        // Map deviation to a heat color (green -> yellow -> red)
        const t = Math.min(defect.metricValue / maxExpectedDeviation, 1.0);
        let r = 0, g = 0, b = 0;
        
        if (t < 0.5) {
          // Green to Yellow
          const t2 = t * 2;
          r = t2;
          g = 1.0;
        } else {
          // Yellow to Red
          const t2 = (t - 0.5) * 2;
          r = 1.0;
          g = 1.0 - t2;
        }
        
        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;
      }
    }
  }

  meshBuffers.colors = colors;
}

/**
 * diagnostic-engine.ts — Full-mesh diagnostic orchestrator
 *
 * Runs all quality metric checks and topology checks across a MeshModel,
 * producing a sorted DefectRecord[] that the AI agent and UI consume.
 *
 * Supports:
 * - Full-mesh analysis
 * - Incremental re-check on a subset of elements (post-fix revalidation)
 * - Configurable quality thresholds
 */

import { MeshModel } from '../core/mesh-model';
import { ElementShape, ElementDimension, getTopology } from '../core/element-types';
import { SpatialIndex } from '../core/spatial-index';
import {
  DefectRecord, DefectType, Severity, FixStrategy,
  QualityThresholds, DEFAULT_THRESHOLDS, DiagnosticSummary,
} from './defect-record';
import {
  aspectRatioTri, aspectRatioQuad, aspectRatioTet, aspectRatioHex,
  jacobianTri, jacobianQuad, jacobianTet,
  warpageQuad,
  skewnessTri, skewnessQuad,
  interiorAnglesTri, interiorAnglesQuad,
  elementQualityTri, elementQualityQuad,
  isZeroAreaTri, isInvertedTet, isInvertedHex,
  computeCentroid,
} from './metrics';

type V3 = [number, number, number];

import { CadQuery } from '../core/cad-kernel';

// ─── Defect ID Generator ─────────────────────────────────────────────────────

let defectCounter = 0;
function nextDefectId(): string {
  return `DEF-${(++defectCounter).toString().padStart(6, '0')}`;
}

export function resetDefectCounter(): void {
  defectCounter = 0;
}

// ─── Diagnostic Engine ───────────────────────────────────────────────────────

export class DiagnosticEngine {
  private model: MeshModel;
  private thresholds: QualityThresholds;
  private cadKernel?: CadQuery;

  constructor(model: MeshModel, thresholds?: Partial<QualityThresholds>, cadKernel?: CadQuery) {
    this.model = model;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.cadKernel = cadKernel;
  }

  /**
   * Run full diagnostic analysis on all elements.
   * Returns defects sorted by severity (highest first).
   */
  runFullDiagnostics(): DefectRecord[] {
    resetDefectCounter();
    const defects: DefectRecord[] = [];

    // 1. Element quality checks
    for (const elem of this.model.elements) {
      const nodes = this.getElementNodes(elem.nodeIds);
      if (!nodes) continue;

      const elemDefects = this.checkElement(elem.id, elem.shape, nodes, elem.componentName);
      defects.push(...elemDefects);
    }

    // 2. Topology checks
    defects.push(...this.checkDuplicateNodes());
    defects.push(...this.checkFreeEdges());
    defects.push(...this.checkNonManifoldEdges());
    defects.push(...this.checkUnreferencedNodes());

    // 3. CAD Conformance checks (if kernel is available)
    if (this.cadKernel) {
      defects.push(...this.checkCadDeviation());
    }

    // Sort by severity (highest first), then by type
    defects.sort((a, b) => {
      if (a.severity !== b.severity) return b.severity - a.severity;
      return a.type.localeCompare(b.type);
    });

    return defects;
  }

  /**
   * Incremental re-check on specific elements only.
   * Used after a fix to revalidate just the touched region.
   */
  revalidateElements(elementIds: number[]): DefectRecord[] {
    const defects: DefectRecord[] = [];

    for (const elemId of elementIds) {
      const elem = this.model.elements.getElement(elemId);
      if (!elem) continue;

      const nodes = this.getElementNodes(elem.nodeIds);
      if (!nodes) continue;

      defects.push(...this.checkElement(elem.id, elem.shape, nodes, elem.componentName));
    }

    defects.sort((a, b) => b.severity - a.severity);
    return defects;
  }

  /**
   * Generate a diagnostic summary report.
   */
  generateSummary(defects: DefectRecord[]): DiagnosticSummary {
    const defectsBySeverity: Record<number, number> = {};
    const defectsByType: Record<string, number> = {};

    for (const d of defects) {
      defectsBySeverity[d.severity] = (defectsBySeverity[d.severity] || 0) + 1;
      defectsByType[d.type] = (defectsByType[d.type] || 0) + 1;
    }

    // Overall quality: percentage of elements with no defects
    const elementsWithDefects = new Set<number>();
    for (const d of defects) {
      d.elementIds.forEach((id) => elementsWithDefects.add(id));
    }
    const totalElements = this.model.elements.count;
    const overallQuality = totalElements > 0
      ? Math.round(((totalElements - elementsWithDefects.size) / totalElements) * 100)
      : 100;

    return {
      totalElements,
      totalNodes: this.model.nodes.count,
      totalDefects: defects.length,
      defectsBySeverity,
      defectsByType,
      overallQualityScore: overallQuality,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Element Quality Checks ──────────────────────────────────────────────

  private checkElement(
    elemId: number, shape: ElementShape, nodes: V3[], componentName: string,
  ): DefectRecord[] {
    const defects: DefectRecord[] = [];
    const topo = getTopology(shape);
    const centroid = computeCentroid(nodes);
    const loc = { x: centroid[0], y: centroid[1], z: centroid[2] };

    if (topo.dimension === ElementDimension.SURFACE) {
      if (shape === ElementShape.TRI3 || shape === ElementShape.TRI6) {
        // Use corner nodes only for quality checks
        const [a, b, c] = [nodes[0], nodes[1], nodes[2]];

        // Zero area check
        if (isZeroAreaTri(a, b, c)) {
          defects.push({
            id: nextDefectId(), type: DefectType.ZERO_AREA_ELEMENT,
            severity: 5, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: 0, threshold: 0,
            suggestedFixStrategy: FixStrategy.COLLAPSE_OR_SPLIT,
            description: `Element ${elemId}: zero-area triangle (degenerate)`,
            componentName,
          });
          return defects; // Skip further checks on degenerate element
        }

        // Aspect ratio
        const ar = aspectRatioTri(a, b, c);
        if (ar > this.thresholds.maxAspectRatio) {
          const sev = this.classifySeverity(ar, this.thresholds.maxAspectRatio, 10);
          defects.push({
            id: nextDefectId(), type: DefectType.ASPECT_RATIO,
            severity: sev, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: ar, threshold: this.thresholds.maxAspectRatio,
            suggestedFixStrategy: FixStrategy.LOCAL_REMESH,
            description: `Element ${elemId}: aspect ratio ${ar.toFixed(2)} exceeds threshold ${this.thresholds.maxAspectRatio}`,
            componentName,
          });
        }

        // Skewness
        const skew = skewnessTri(a, b, c);
        if (skew > this.thresholds.maxSkewness) {
          const sev = this.classifySeverity(skew, this.thresholds.maxSkewness, 0.95);
          defects.push({
            id: nextDefectId(), type: DefectType.SKEWNESS,
            severity: sev, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: skew, threshold: this.thresholds.maxSkewness,
            suggestedFixStrategy: FixStrategy.LAPLACIAN_SMOOTH,
            description: `Element ${elemId}: skewness ${skew.toFixed(3)} exceeds threshold ${this.thresholds.maxSkewness}`,
            componentName,
          });
        }

        // Interior angles
        const angles = interiorAnglesTri(a, b, c);
        const minAngle = Math.min(...angles);
        const maxAngle = Math.max(...angles);

        if (minAngle < this.thresholds.minAngleTri) {
          defects.push({
            id: nextDefectId(), type: DefectType.MIN_ANGLE,
            severity: minAngle < 10 ? 4 : 3 as Severity,
            elementIds: [elemId], nodeIds: [], location: loc,
            metricValue: minAngle, threshold: this.thresholds.minAngleTri,
            suggestedFixStrategy: FixStrategy.LAPLACIAN_SMOOTH,
            description: `Element ${elemId}: min angle ${minAngle.toFixed(1)}° below threshold ${this.thresholds.minAngleTri}°`,
            componentName,
          });
        }

        if (maxAngle > this.thresholds.maxAngleTri) {
          defects.push({
            id: nextDefectId(), type: DefectType.MAX_ANGLE,
            severity: maxAngle > 160 ? 4 : 3 as Severity,
            elementIds: [elemId], nodeIds: [], location: loc,
            metricValue: maxAngle, threshold: this.thresholds.maxAngleTri,
            suggestedFixStrategy: FixStrategy.LAPLACIAN_SMOOTH,
            description: `Element ${elemId}: max angle ${maxAngle.toFixed(1)}° above threshold ${this.thresholds.maxAngleTri}°`,
            componentName,
          });
        }

        // Element quality
        const quality = elementQualityTri(a, b, c);
        if (quality < this.thresholds.minElementQuality) {
          defects.push({
            id: nextDefectId(), type: DefectType.ELEMENT_QUALITY,
            severity: quality < 0.1 ? 4 : 2 as Severity,
            elementIds: [elemId], nodeIds: [], location: loc,
            metricValue: quality, threshold: this.thresholds.minElementQuality,
            suggestedFixStrategy: FixStrategy.LOCAL_REMESH,
            description: `Element ${elemId}: quality score ${quality.toFixed(3)} below threshold ${this.thresholds.minElementQuality}`,
            componentName,
          });
        }
      } else if (shape === ElementShape.QUAD4 || shape === ElementShape.QUAD8) {
        const [a, b, c, d] = [nodes[0], nodes[1], nodes[2], nodes[3]];

        // Aspect ratio
        const ar = aspectRatioQuad(a, b, c, d);
        if (ar > this.thresholds.maxAspectRatio) {
          const sev = this.classifySeverity(ar, this.thresholds.maxAspectRatio, 10);
          defects.push({
            id: nextDefectId(), type: DefectType.ASPECT_RATIO,
            severity: sev, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: ar, threshold: this.thresholds.maxAspectRatio,
            suggestedFixStrategy: FixStrategy.LOCAL_REMESH,
            description: `Element ${elemId}: aspect ratio ${ar.toFixed(2)} exceeds threshold ${this.thresholds.maxAspectRatio}`,
            componentName,
          });
        }

        // Jacobian
        const jac = jacobianQuad(a, b, c, d);
        if (jac < this.thresholds.minJacobian) {
          const sev: Severity = jac <= 0 ? 5 : jac < 0.1 ? 4 : 3;
          defects.push({
            id: nextDefectId(), type: DefectType.JACOBIAN,
            severity: sev, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: jac, threshold: this.thresholds.minJacobian,
            suggestedFixStrategy: jac <= 0 ? FixStrategy.FLIP_NORMALS : FixStrategy.LAPLACIAN_SMOOTH,
            description: `Element ${elemId}: Jacobian ratio ${jac.toFixed(3)} ${jac <= 0 ? '(INVERTED)' : `below threshold ${this.thresholds.minJacobian}`}`,
            componentName,
          });
        }

        // Warpage
        const warp = warpageQuad(a, b, c, d);
        if (warp > this.thresholds.maxWarpage) {
          const sev = this.classifySeverity(warp, this.thresholds.maxWarpage, 45);
          defects.push({
            id: nextDefectId(), type: DefectType.WARPAGE,
            severity: sev, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: warp, threshold: this.thresholds.maxWarpage,
            suggestedFixStrategy: FixStrategy.LAPLACIAN_SMOOTH,
            description: `Element ${elemId}: warpage ${warp.toFixed(1)}° exceeds threshold ${this.thresholds.maxWarpage}°`,
            componentName,
          });
        }

        // Skewness
        const skew = skewnessQuad(a, b, c, d);
        if (skew > this.thresholds.maxSkewness) {
          const sev = this.classifySeverity(skew, this.thresholds.maxSkewness, 0.95);
          defects.push({
            id: nextDefectId(), type: DefectType.SKEWNESS,
            severity: sev, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: skew, threshold: this.thresholds.maxSkewness,
            suggestedFixStrategy: FixStrategy.LAPLACIAN_SMOOTH,
            description: `Element ${elemId}: skewness ${skew.toFixed(3)} exceeds threshold ${this.thresholds.maxSkewness}`,
            componentName,
          });
        }

        // Interior angles
        const angles = interiorAnglesQuad(a, b, c, d);
        const minAngle = Math.min(...angles);
        const maxAngle = Math.max(...angles);

        if (minAngle < this.thresholds.minAngleQuad) {
          defects.push({
            id: nextDefectId(), type: DefectType.MIN_ANGLE,
            severity: minAngle < 15 ? 4 : 3 as Severity,
            elementIds: [elemId], nodeIds: [], location: loc,
            metricValue: minAngle, threshold: this.thresholds.minAngleQuad,
            suggestedFixStrategy: FixStrategy.LAPLACIAN_SMOOTH,
            description: `Element ${elemId}: min angle ${minAngle.toFixed(1)}° below threshold ${this.thresholds.minAngleQuad}°`,
            componentName,
          });
        }

        if (maxAngle > this.thresholds.maxAngleQuad) {
          defects.push({
            id: nextDefectId(), type: DefectType.MAX_ANGLE,
            severity: maxAngle > 170 ? 4 : 3 as Severity,
            elementIds: [elemId], nodeIds: [], location: loc,
            metricValue: maxAngle, threshold: this.thresholds.maxAngleQuad,
            suggestedFixStrategy: FixStrategy.LAPLACIAN_SMOOTH,
            description: `Element ${elemId}: max angle ${maxAngle.toFixed(1)}° above threshold ${this.thresholds.maxAngleQuad}°`,
            componentName,
          });
        }

        // Element quality
        const quality = elementQualityQuad(a, b, c, d);
        if (quality < this.thresholds.minElementQuality) {
          defects.push({
            id: nextDefectId(), type: DefectType.ELEMENT_QUALITY,
            severity: quality < 0.1 ? 4 : 2 as Severity,
            elementIds: [elemId], nodeIds: [], location: loc,
            metricValue: quality, threshold: this.thresholds.minElementQuality,
            suggestedFixStrategy: FixStrategy.LOCAL_REMESH,
            description: `Element ${elemId}: quality score ${quality.toFixed(3)} below threshold ${this.thresholds.minElementQuality}`,
            componentName,
          });
        }
      }
    } else if (topo.dimension === ElementDimension.VOLUME) {
      if (shape === ElementShape.TET4 || shape === ElementShape.TET10) {
        const [a, b, c, d] = [nodes[0], nodes[1], nodes[2], nodes[3]];

        if (isInvertedTet(a, b, c, d)) {
          defects.push({
            id: nextDefectId(), type: DefectType.INVERTED_ELEMENT,
            severity: 5, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: -1, threshold: 0,
            suggestedFixStrategy: FixStrategy.FLIP_NORMALS,
            description: `Element ${elemId}: inverted tetrahedron (negative volume)`,
            componentName,
          });
        }

        const ar = aspectRatioTet(a, b, c, d);
        if (ar > this.thresholds.maxAspectRatio) {
          const sev = this.classifySeverity(ar, this.thresholds.maxAspectRatio, 10);
          defects.push({
            id: nextDefectId(), type: DefectType.ASPECT_RATIO,
            severity: sev, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: ar, threshold: this.thresholds.maxAspectRatio,
            suggestedFixStrategy: FixStrategy.LOCAL_REMESH,
            description: `Element ${elemId}: aspect ratio ${ar.toFixed(2)} exceeds threshold`,
            componentName,
          });
        }
      } else if (shape === ElementShape.HEX8 || shape === ElementShape.HEX20) {
        if (isInvertedHex(nodes)) {
          defects.push({
            id: nextDefectId(), type: DefectType.INVERTED_ELEMENT,
            severity: 5, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: -1, threshold: 0,
            suggestedFixStrategy: FixStrategy.FLIP_NORMALS,
            description: `Element ${elemId}: inverted hexahedron`,
            componentName,
          });
        }

        const ar = aspectRatioHex(nodes);
        if (ar > this.thresholds.maxAspectRatio) {
          const sev = this.classifySeverity(ar, this.thresholds.maxAspectRatio, 10);
          defects.push({
            id: nextDefectId(), type: DefectType.ASPECT_RATIO,
            severity: sev, elementIds: [elemId], nodeIds: [],
            location: loc, metricValue: ar, threshold: this.thresholds.maxAspectRatio,
            suggestedFixStrategy: FixStrategy.LOCAL_REMESH,
            description: `Element ${elemId}: aspect ratio ${ar.toFixed(2)} exceeds threshold`,
            componentName,
          });
        }
      }
    }

    return defects;
  }

  // ─── Topology Checks ────────────────────────────────────────────────────

  private checkDuplicateNodes(): DefectRecord[] {
    const defects: DefectRecord[] = [];
    const spatialIndex = SpatialIndex.fromNodeStore(this.model.nodes);
    const groups = spatialIndex.findDuplicates(this.model.nodes, this.thresholds.duplicateNodeTolerance);

    for (const group of groups) {
      const firstNode = this.model.nodes.getNode(group[0]);
      const loc = firstNode ? { x: firstNode.x, y: firstNode.y, z: firstNode.z } : { x: 0, y: 0, z: 0 };

      defects.push({
        id: nextDefectId(),
        type: DefectType.DUPLICATE_NODES,
        severity: 3,
        elementIds: [],
        nodeIds: group,
        location: loc,
        metricValue: group.length,
        threshold: 1,
        suggestedFixStrategy: FixStrategy.DEDUPLICATE_NODES,
        description: `${group.length} duplicate nodes within tolerance ${this.thresholds.duplicateNodeTolerance}: [${group.join(', ')}]`,
      });
    }

    return defects;
  }

  private checkFreeEdges(): DefectRecord[] {
    const defects: DefectRecord[] = [];
    const edgeMap = this.model.buildEdgeMap();

    for (const [edgeKey, elemIds] of edgeMap) {
      // For shell meshes: a free edge is shared by only 1 element
      // (exterior boundary edges are expected, but internal free edges are defects)
      if (elemIds.length === 1) {
        const [nidA, nidB] = edgeKey.split('-').map(Number);
        const nodeA = this.model.nodes.getNode(nidA);
        const nodeB = this.model.nodes.getNode(nidB);
        const loc = nodeA && nodeB
          ? { x: (nodeA.x + nodeB.x) / 2, y: (nodeA.y + nodeB.y) / 2, z: (nodeA.z + nodeB.z) / 2 }
          : { x: 0, y: 0, z: 0 };

        defects.push({
          id: nextDefectId(),
          type: DefectType.FREE_EDGES,
          severity: 2,
          elementIds: elemIds,
          nodeIds: [nidA, nidB],
          location: loc,
          metricValue: 1,
          threshold: 2,
          suggestedFixStrategy: FixStrategy.LOCAL_REMESH,
          description: `Free edge between nodes ${nidA}-${nidB} (element ${elemIds[0]})`,
        });
      }
    }

    return defects;
  }

  private checkNonManifoldEdges(): DefectRecord[] {
    const defects: DefectRecord[] = [];
    const edgeMap = this.model.buildEdgeMap();

    for (const [edgeKey, elemIds] of edgeMap) {
      // For shell meshes: non-manifold = shared by >2 elements
      if (elemIds.length > 2) {
        const [nidA, nidB] = edgeKey.split('-').map(Number);
        const nodeA = this.model.nodes.getNode(nidA);
        const nodeB = this.model.nodes.getNode(nidB);
        const loc = nodeA && nodeB
          ? { x: (nodeA.x + nodeB.x) / 2, y: (nodeA.y + nodeB.y) / 2, z: (nodeA.z + nodeB.z) / 2 }
          : { x: 0, y: 0, z: 0 };

        defects.push({
          id: nextDefectId(),
          type: DefectType.NON_MANIFOLD_EDGE,
          severity: 4,
          elementIds: elemIds,
          nodeIds: [nidA, nidB],
          location: loc,
          metricValue: elemIds.length,
          threshold: 2,
          suggestedFixStrategy: FixStrategy.MANUAL_REVIEW,
          description: `Non-manifold edge ${nidA}-${nidB}: shared by ${elemIds.length} elements`,
        });
      }
    }

    return defects;
  }

  private checkUnreferencedNodes(): DefectRecord[] {
    const defects: DefectRecord[] = [];
    const referenced = this.model.getReferencedNodeIds();
    const allNodeIds = this.model.nodes.ids;

    const unreferenced = allNodeIds.filter((id) => !referenced.has(id));

    if (unreferenced.length > 0) {
      // Group into a single defect
      const firstNode = this.model.nodes.getNode(unreferenced[0]);
      const loc = firstNode
        ? { x: firstNode.x, y: firstNode.y, z: firstNode.z }
        : { x: 0, y: 0, z: 0 };

      defects.push({
        id: nextDefectId(),
        type: DefectType.UNREFERENCED_NODES,
        severity: 1,
        elementIds: [],
        nodeIds: unreferenced,
        location: loc,
        metricValue: unreferenced.length,
        threshold: 0,
        suggestedFixStrategy: FixStrategy.REMOVE_UNREFERENCED,
        description: `${unreferenced.length} unreferenced node(s) not connected to any element`,
      });
    }

    return defects;
  }

  // ─── CAD Conformance Checks ──────────────────────────────────────────────

  private checkCadDeviation(): DefectRecord[] {
    if (!this.cadKernel) return [];
    
    const defects: DefectRecord[] = [];
    const tol = this.thresholds.cadDeviationTolerance;
    
    // In a real app, we might sample nodes for performance, but for Phase 2 we check all.
    const allNodeIds = this.model.nodes.ids;
    
    for (const nid of allNodeIds) {
      const xyz = this.model.nodes.getXYZ(nid);
      if (!xyz) continue;
      
      try {
        const result = this.cadKernel.nearestSurfacePoint(xyz);
        
        if (result.distance > tol) {
          // Find which elements use this node so we can highlight them
          const elementIds = this.model.elements.getElementsUsingNode(nid);
          
          const sev = this.classifySeverity(result.distance, tol, tol * 2);
          
          defects.push({
            id: nextDefectId(),
            type: DefectType.CAD_DEVIATION,
            severity: sev,
            elementIds,
            nodeIds: [nid],
            location: { x: xyz[0], y: xyz[1], z: xyz[2] },
            metricValue: result.distance,
            threshold: tol,
            suggestedFixStrategy: FixStrategy.PROJECT_TO_CAD,
            description: `Node ${nid} deviates from CAD by ${result.distance.toFixed(4)} (threshold: ${tol})`,
          });
        }
      } catch (err) {
        // Skip nodes where projection fails
      }
    }
    
    return defects;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Get node coordinates as V3 tuples for an element */
  private getElementNodes(nodeIds: number[]): V3[] | null {
    const nodes: V3[] = [];
    for (const nid of nodeIds) {
      const xyz = this.model.nodes.getXYZ(nid);
      if (!xyz) return null;
      nodes.push(xyz);
    }
    return nodes;
  }

  /** Classify severity based on how far a metric exceeds its threshold */
  private classifySeverity(value: number, warnThreshold: number, failThreshold: number): Severity {
    if (value >= failThreshold) return 5;
    const ratio = (value - warnThreshold) / (failThreshold - warnThreshold);
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  }
}

/**
 * mesh-model.ts — Canonical FE Mesh Data Model
 *
 * Format-agnostic internal representation of a finite element mesh.
 * Uses typed arrays (Float64Array, Int32Array) for performance and
 * GPU-transfer compatibility. All parsers convert to this model,
 * and all writers/diagnostics/viewers consume it.
 *
 * Design invariants:
 * - Node coordinates stored in a flat Float64Array: [x0,y0,z0, x1,y1,z1, ...]
 * - Element connectivity stored per-element as Int32Array of global node IDs
 * - Element attributes (MAT, REAL, SECNUM, ESYS) preserved as parallel maps for lossless round-trip
 * - Components/groups are named sets of element IDs
 * - Immutable snapshots via clone() for undo/redo
 */

import { ElementShape, getTopology, getCornerEdges, getCornerFaces } from './element-types';

// ─── Core Types ──────────────────────────────────────────────────────────────

/** 3D coordinate */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Source format this mesh was imported from */
export enum MeshFormat {
  CDB = 'cdb',
  INP = 'inp',
  BDF = 'bdf',
  UNKNOWN = 'unknown',
}

/** Per-element attributes preserved for lossless round-trip export */
export interface ElementAttributes {
  materialId: number;
  realConstantId: number;
  sectionId: number;
  coordinateSystemId: number;
  /** Format-specific type reference (e.g., MAPDL ET reference number) */
  formatTypeRef: number;
  /** Property ID (Nastran PID, Abaqus section reference) */
  propertyId: number;
}

/** Information about a named component / element group */
export interface ComponentInfo {
  name: string;
  elementIds: Set<number>;
  nodeIds: Set<number>;
  /** Original component type (e.g., 'NODE', 'ELEMENT', 'VOLU') for CMBLOCK round-trip */
  originalType?: string;
}

/** Model-level metadata for provenance tracking */
export interface MeshMetadata {
  sourceFormat: MeshFormat;
  sourceFilePath?: string;
  title?: string;
  units?: string;
  /** Format-specific extra data that must survive round-trip (e.g., MAPDL ET definitions) */
  formatExtras: Record<string, unknown>;
}

/** A single element in the mesh */
export interface MeshElement {
  id: number;
  shape: ElementShape;
  /** Global node IDs in connectivity order matching the element topology */
  nodeIds: number[];
  /** Component/part this element belongs to (empty string = unassigned) */
  componentName: string;
  /** Per-element attributes for round-trip fidelity */
  attrs: ElementAttributes;
}

// ─── Node Store ──────────────────────────────────────────────────────────────

/**
 * Efficient node storage backed by a flat Float64Array.
 * Maps node IDs (which may be non-contiguous, e.g., 1, 5, 1000)
 * to internal indices for the coordinate array.
 */
export class NodeStore {
  /** Flat coordinate array: [x0,y0,z0, x1,y1,z1, ...] */
  private coords: Float64Array;
  /** Node ID → internal index */
  private idToIndex: Map<number, number>;
  /** Internal index → node ID */
  private indexToId: number[];
  /** Next available internal index */
  private nextIndex: number;

  constructor(capacity: number = 1024) {
    this.coords = new Float64Array(capacity * 3);
    this.idToIndex = new Map();
    this.indexToId = [];
    this.nextIndex = 0;
  }

  /** Number of nodes */
  get count(): number {
    return this.nextIndex;
  }

  /** All node IDs */
  get ids(): number[] {
    return this.indexToId.slice(0, this.nextIndex);
  }

  /** Raw coordinate array (for GPU upload / Web Worker transfer) */
  get rawCoords(): Float64Array {
    return this.coords.subarray(0, this.nextIndex * 3);
  }

  /** Add a node. Overwrites if ID already exists. */
  addNode(id: number, x: number, y: number, z: number): void {
    let idx = this.idToIndex.get(id);
    if (idx === undefined) {
      idx = this.nextIndex++;
      this.idToIndex.set(id, idx);
      this.indexToId[idx] = id;
      // Grow array if needed
      if (idx * 3 + 2 >= this.coords.length) {
        const newCoords = new Float64Array(this.coords.length * 2);
        newCoords.set(this.coords);
        this.coords = newCoords;
      }
    }
    this.coords[idx * 3] = x;
    this.coords[idx * 3 + 1] = y;
    this.coords[idx * 3 + 2] = z;
  }

  /** Get coordinates of a node by ID. Returns null if not found. */
  getNode(id: number): Vec3 | null {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return null;
    return {
      x: this.coords[idx * 3],
      y: this.coords[idx * 3 + 1],
      z: this.coords[idx * 3 + 2],
    };
  }

  /** Get coordinates as a flat [x, y, z] tuple for fast math. */
  getXYZ(id: number): [number, number, number] | null {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return null;
    const base = idx * 3;
    return [this.coords[base], this.coords[base + 1], this.coords[base + 2]];
  }

  /** Update coordinates of an existing node. Returns false if not found. */
  setNode(id: number, x: number, y: number, z: number): boolean {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return false;
    this.coords[idx * 3] = x;
    this.coords[idx * 3 + 1] = y;
    this.coords[idx * 3 + 2] = z;
    return true;
  }

  /** Check if a node ID exists */
  hasNode(id: number): boolean {
    return this.idToIndex.has(id);
  }

  /** Remove a node by ID */
  removeNode(id: number): boolean {
    // Mark as removed but don't compact (keep indices stable for current operation)
    return this.idToIndex.delete(id);
  }

  /** Iterate over all nodes */
  *[Symbol.iterator](): Generator<{ id: number; x: number; y: number; z: number }> {
    for (const [id, idx] of this.idToIndex) {
      const base = idx * 3;
      yield {
        id,
        x: this.coords[base],
        y: this.coords[base + 1],
        z: this.coords[base + 2],
      };
    }
  }

  /** Create a deep clone */
  clone(): NodeStore {
    const copy = new NodeStore(this.nextIndex);
    copy.coords = new Float64Array(this.coords);
    copy.idToIndex = new Map(this.idToIndex);
    copy.indexToId = [...this.indexToId];
    copy.nextIndex = this.nextIndex;
    return copy;
  }
}

// ─── Element Store ───────────────────────────────────────────────────────────

/**
 * Storage for mesh elements with fast lookup by ID.
 */
export class ElementStore {
  private elements: Map<number, MeshElement>;

  constructor() {
    this.elements = new Map();
  }

  get count(): number {
    return this.elements.size;
  }

  get ids(): number[] {
    return Array.from(this.elements.keys());
  }

  addElement(element: MeshElement): void {
    this.elements.set(element.id, element);
  }

  getElement(id: number): MeshElement | undefined {
    return this.elements.get(id);
  }

  hasElement(id: number): boolean {
    return this.elements.has(id);
  }

  removeElement(id: number): boolean {
    return this.elements.delete(id);
  }

  /** Iterate over all elements */
  *[Symbol.iterator](): Generator<MeshElement> {
    for (const elem of this.elements.values()) {
      yield elem;
    }
  }

  /** Get elements by component name */
  getByComponent(componentName: string): MeshElement[] {
    const result: MeshElement[] = [];
    for (const elem of this.elements.values()) {
      if (elem.componentName === componentName) {
        result.push(elem);
      }
    }
    return result;
  }

  /** Get all elements of a specific shape */
  getByShape(shape: ElementShape): MeshElement[] {
    const result: MeshElement[] = [];
    for (const elem of this.elements.values()) {
      if (elem.shape === shape) {
        result.push(elem);
      }
    }
    return result;
  }

  /** Get all elements using a specific node ID */
  getElementsUsingNode(nodeId: number): number[] {
    const result: number[] = [];
    for (const elem of this.elements.values()) {
      if (elem.nodeIds.includes(nodeId)) {
        result.push(elem.id);
      }
    }
    return result;
  }

  /** Create a deep clone */
  clone(): ElementStore {
    const copy = new ElementStore();
    for (const [id, elem] of this.elements) {
      copy.elements.set(id, {
        ...elem,
        nodeIds: [...elem.nodeIds],
        attrs: { ...elem.attrs },
      });
    }
    return copy;
  }
}

// ─── Mesh Model ──────────────────────────────────────────────────────────────

/**
 * The canonical mesh model — the single source of truth consumed by
 * the diagnostic engine, 3D viewer, AI agent, and export writers.
 */
export class MeshModel {
  public nodes: NodeStore;
  public elements: ElementStore;
  public components: Map<string, ComponentInfo>;
  public metadata: MeshMetadata;

  constructor() {
    this.nodes = new NodeStore();
    this.elements = new ElementStore();
    this.components = new Map();
    this.metadata = {
      sourceFormat: MeshFormat.UNKNOWN,
      formatExtras: {},
    };
  }

  // ─── Summary Statistics ──────────────────────────────────────────────────

  /** Count elements by shape */
  getElementCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const elem of this.elements) {
      counts[elem.shape] = (counts[elem.shape] || 0) + 1;
    }
    return counts;
  }

  /** Get the axis-aligned bounding box of all nodes */
  getBoundingBox(): { min: Vec3; max: Vec3 } {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const node of this.nodes) {
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.z < minZ) minZ = node.z;
      if (node.x > maxX) maxX = node.x;
      if (node.y > maxY) maxY = node.y;
      if (node.z > maxZ) maxZ = node.z;
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }

  /** Get the centroid of all nodes */
  getCentroid(): Vec3 {
    let sx = 0, sy = 0, sz = 0;
    let n = 0;
    for (const node of this.nodes) {
      sx += node.x;
      sy += node.y;
      sz += node.z;
      n++;
    }
    return n > 0
      ? { x: sx / n, y: sy / n, z: sz / n }
      : { x: 0, y: 0, z: 0 };
  }

  // ─── Topology Queries ────────────────────────────────────────────────────

  /**
   * Build an edge-to-element adjacency map.
   * Key: "minNodeId-maxNodeId", Value: element IDs sharing this edge.
   * Used for free edge / non-manifold detection.
   */
  buildEdgeMap(): Map<string, number[]> {
    const edgeMap = new Map<string, number[]>();

    for (const elem of this.elements) {
      const cornerEdges = getCornerEdges(elem.shape);
      for (const [localA, localB] of cornerEdges) {
        const nodeA = elem.nodeIds[localA];
        const nodeB = elem.nodeIds[localB];
        if (nodeA === undefined || nodeB === undefined) continue;
        const key = nodeA < nodeB ? `${nodeA}-${nodeB}` : `${nodeB}-${nodeA}`;
        const list = edgeMap.get(key);
        if (list) {
          list.push(elem.id);
        } else {
          edgeMap.set(key, [elem.id]);
        }
      }
    }
    return edgeMap;
  }

  /**
   * Build a face-to-element adjacency map for 3D elements.
   * Key: sorted corner node IDs joined by "-".
   * Used for detecting shared faces between solid elements.
   */
  buildFaceMap(): Map<string, number[]> {
    const faceMap = new Map<string, number[]>();

    for (const elem of this.elements) {
      const cornerFaces = getCornerFaces(elem.shape);
      for (const face of cornerFaces) {
        const nodeIds = face.map((localIdx) => elem.nodeIds[localIdx]).filter((id) => id !== undefined);
        const key = [...nodeIds].sort((a, b) => a - b).join('-');
        const list = faceMap.get(key);
        if (list) {
          list.push(elem.id);
        } else {
          faceMap.set(key, [elem.id]);
        }
      }
    }
    return faceMap;
  }

  /**
   * Find all node IDs referenced by elements.
   * Compare with this.nodes.ids to find unreferenced nodes.
   */
  getReferencedNodeIds(): Set<number> {
    const referenced = new Set<number>();
    for (const elem of this.elements) {
      for (const nid of elem.nodeIds) {
        referenced.add(nid);
      }
    }
    return referenced;
  }

  // ─── Cloning ─────────────────────────────────────────────────────────────

  /** Deep clone the entire model (for undo snapshots or sandboxed fix evaluation) */
  clone(): MeshModel {
    const copy = new MeshModel();
    copy.nodes = this.nodes.clone();
    copy.elements = this.elements.clone();
    copy.metadata = {
      ...this.metadata,
      formatExtras: JSON.parse(JSON.stringify(this.metadata.formatExtras)),
    };
    for (const [name, info] of this.components) {
      copy.components.set(name, {
        name: info.name,
        elementIds: new Set(info.elementIds),
        nodeIds: new Set(info.nodeIds),
        originalType: info.originalType,
      });
    }
    return copy;
  }
}

// ─── Default Element Attributes ──────────────────────────────────────────────

export function defaultElementAttributes(): ElementAttributes {
  return {
    materialId: 1,
    realConstantId: 1,
    sectionId: 1,
    coordinateSystemId: 0,
    formatTypeRef: 0,
    propertyId: 0,
  };
}

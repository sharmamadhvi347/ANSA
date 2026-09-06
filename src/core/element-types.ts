/**
 * element-types.ts — Canonical FE element type registry
 *
 * Maps format-specific element types (ANSYS SOLID185, Nastran CHEXA, Abaqus C3D8R)
 * to a unified canonical type system. Each type knows its topology: node count,
 * face definitions, edge definitions, and ideal angles for quality metrics.
 */

// ─── Canonical Element Shape ─────────────────────────────────────────────────

export enum ElementShape {
  TRI3 = 'TRI3',
  TRI6 = 'TRI6',
  QUAD4 = 'QUAD4',
  QUAD8 = 'QUAD8',
  TET4 = 'TET4',
  TET10 = 'TET10',
  HEX8 = 'HEX8',
  HEX20 = 'HEX20',
  WEDGE6 = 'WEDGE6',
  WEDGE15 = 'WEDGE15',
  BEAM2 = 'BEAM2',
  BEAM3 = 'BEAM3',
  POINT = 'POINT',
}

// ─── Element Dimension ───────────────────────────────────────────────────────

export enum ElementDimension {
  POINT = 0,
  LINE = 1,
  SURFACE = 2,
  VOLUME = 3,
}

// ─── Element Topology Definition ─────────────────────────────────────────────

/**
 * Face definition: ordered list of local node indices forming each face.
 * For 2D elements, faces are the element itself.
 * For 3D elements, faces are the bounding surfaces.
 */
export interface ElementTopology {
  /** Canonical shape name */
  shape: ElementShape;
  /** Spatial dimension: 0=point, 1=line, 2=surface, 3=volume */
  dimension: ElementDimension;
  /** Number of nodes defining this element */
  nodeCount: number;
  /** Ordered pairs of local node indices forming each edge: [[n1,n2], ...] */
  edges: [number, number][];
  /** Ordered lists of local node indices forming each face */
  faces: number[][];
  /** Ideal interior angle in degrees for quality checks (60° for tri, 90° for quad) */
  idealAngle: number;
  /** Whether this is a higher-order (quadratic) element */
  isQuadratic: boolean;
}

// ─── Topology Definitions ────────────────────────────────────────────────────

const TOPOLOGIES: Record<ElementShape, ElementTopology> = {
  [ElementShape.POINT]: {
    shape: ElementShape.POINT,
    dimension: ElementDimension.POINT,
    nodeCount: 1,
    edges: [],
    faces: [],
    idealAngle: 0,
    isQuadratic: false,
  },

  [ElementShape.BEAM2]: {
    shape: ElementShape.BEAM2,
    dimension: ElementDimension.LINE,
    nodeCount: 2,
    edges: [[0, 1]],
    faces: [],
    idealAngle: 180,
    isQuadratic: false,
  },

  [ElementShape.BEAM3]: {
    shape: ElementShape.BEAM3,
    dimension: ElementDimension.LINE,
    nodeCount: 3,
    edges: [[0, 1], [1, 2]],
    faces: [],
    idealAngle: 180,
    isQuadratic: true,
  },

  [ElementShape.TRI3]: {
    shape: ElementShape.TRI3,
    dimension: ElementDimension.SURFACE,
    nodeCount: 3,
    edges: [[0, 1], [1, 2], [2, 0]],
    faces: [[0, 1, 2]],
    idealAngle: 60,
    isQuadratic: false,
  },

  [ElementShape.TRI6]: {
    shape: ElementShape.TRI6,
    dimension: ElementDimension.SURFACE,
    nodeCount: 6,
    edges: [[0, 3], [3, 1], [1, 4], [4, 2], [2, 5], [5, 0]],
    faces: [[0, 3, 1, 4, 2, 5]],
    idealAngle: 60,
    isQuadratic: true,
  },

  [ElementShape.QUAD4]: {
    shape: ElementShape.QUAD4,
    dimension: ElementDimension.SURFACE,
    nodeCount: 4,
    edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
    faces: [[0, 1, 2, 3]],
    idealAngle: 90,
    isQuadratic: false,
  },

  [ElementShape.QUAD8]: {
    shape: ElementShape.QUAD8,
    dimension: ElementDimension.SURFACE,
    nodeCount: 8,
    edges: [[0, 4], [4, 1], [1, 5], [5, 2], [2, 6], [6, 3], [3, 7], [7, 0]],
    faces: [[0, 4, 1, 5, 2, 6, 3, 7]],
    idealAngle: 90,
    isQuadratic: true,
  },

  [ElementShape.TET4]: {
    shape: ElementShape.TET4,
    dimension: ElementDimension.VOLUME,
    nodeCount: 4,
    edges: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]],
    faces: [
      [0, 1, 2], // face 0
      [0, 1, 3], // face 1
      [0, 2, 3], // face 2
      [1, 2, 3], // face 3
    ],
    idealAngle: 70.53, // arccos(1/3) ≈ 70.53° for regular tet
    isQuadratic: false,
  },

  [ElementShape.TET10]: {
    shape: ElementShape.TET10,
    dimension: ElementDimension.VOLUME,
    nodeCount: 10,
    edges: [
      [0, 4], [4, 1], [0, 5], [5, 2], [0, 6], [6, 3],
      [1, 7], [7, 2], [1, 8], [8, 3], [2, 9], [9, 3],
    ],
    faces: [
      [0, 4, 1, 7, 2, 5],
      [0, 4, 1, 8, 3, 6],
      [0, 5, 2, 9, 3, 6],
      [1, 7, 2, 9, 3, 8],
    ],
    idealAngle: 70.53,
    isQuadratic: true,
  },

  [ElementShape.HEX8]: {
    shape: ElementShape.HEX8,
    dimension: ElementDimension.VOLUME,
    nodeCount: 8,
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 0], // bottom
      [4, 5], [5, 6], [6, 7], [7, 4], // top
      [0, 4], [1, 5], [2, 6], [3, 7], // vertical
    ],
    faces: [
      [0, 1, 2, 3], // bottom
      [4, 5, 6, 7], // top
      [0, 1, 5, 4], // front
      [1, 2, 6, 5], // right
      [2, 3, 7, 6], // back
      [3, 0, 4, 7], // left
    ],
    idealAngle: 90,
    isQuadratic: false,
  },

  [ElementShape.HEX20]: {
    shape: ElementShape.HEX20,
    dimension: ElementDimension.VOLUME,
    nodeCount: 20,
    edges: [
      [0, 8], [8, 1], [1, 9], [9, 2], [2, 10], [10, 3], [3, 11], [11, 0],
      [4, 12], [12, 5], [5, 13], [13, 6], [6, 14], [14, 7], [7, 15], [15, 4],
      [0, 16], [16, 4], [1, 17], [17, 5], [2, 18], [18, 6], [3, 19], [19, 7],
    ],
    faces: [
      [0, 8, 1, 9, 2, 10, 3, 11],
      [4, 12, 5, 13, 6, 14, 7, 15],
      [0, 8, 1, 17, 5, 12, 4, 16],
      [1, 9, 2, 18, 6, 13, 5, 17],
      [2, 10, 3, 19, 7, 14, 6, 18],
      [3, 11, 0, 16, 4, 15, 7, 19],
    ],
    idealAngle: 90,
    isQuadratic: true,
  },

  [ElementShape.WEDGE6]: {
    shape: ElementShape.WEDGE6,
    dimension: ElementDimension.VOLUME,
    nodeCount: 6,
    edges: [
      [0, 1], [1, 2], [2, 0], // bottom tri
      [3, 4], [4, 5], [5, 3], // top tri
      [0, 3], [1, 4], [2, 5], // vertical
    ],
    faces: [
      [0, 1, 2],       // bottom (tri)
      [3, 4, 5],       // top (tri)
      [0, 1, 4, 3],    // quad face 1
      [1, 2, 5, 4],    // quad face 2
      [2, 0, 3, 5],    // quad face 3
    ],
    idealAngle: 60, // tri faces
    isQuadratic: false,
  },

  [ElementShape.WEDGE15]: {
    shape: ElementShape.WEDGE15,
    dimension: ElementDimension.VOLUME,
    nodeCount: 15,
    edges: [
      [0, 6], [6, 1], [1, 7], [7, 2], [2, 8], [8, 0],
      [3, 9], [9, 4], [4, 10], [10, 5], [5, 11], [11, 3],
      [0, 12], [12, 3], [1, 13], [13, 4], [2, 14], [14, 5],
    ],
    faces: [
      [0, 6, 1, 7, 2, 8],
      [3, 9, 4, 10, 5, 11],
      [0, 6, 1, 13, 4, 9, 3, 12],
      [1, 7, 2, 14, 5, 10, 4, 13],
      [2, 8, 0, 12, 3, 11, 5, 14],
    ],
    idealAngle: 60,
    isQuadratic: true,
  },
};

// ─── Topology Lookup ─────────────────────────────────────────────────────────

export function getTopology(shape: ElementShape): ElementTopology {
  return TOPOLOGIES[shape];
}

export function getCornerNodeCount(shape: ElementShape): number {
  const topo = TOPOLOGIES[shape];
  if (topo.isQuadratic) {
    // Corner nodes for quadratic elements
    switch (shape) {
      case ElementShape.TRI6: return 3;
      case ElementShape.QUAD8: return 4;
      case ElementShape.TET10: return 4;
      case ElementShape.HEX20: return 8;
      case ElementShape.WEDGE15: return 6;
      case ElementShape.BEAM3: return 2;
      default: return topo.nodeCount;
    }
  }
  return topo.nodeCount;
}

/**
 * Get corner-node-only edges for an element (ignoring mid-side nodes).
 * Used for topology checks (free edges, manifold) where mid-side nodes are irrelevant.
 */
export function getCornerEdges(shape: ElementShape): [number, number][] {
  switch (shape) {
    case ElementShape.TRI3:
    case ElementShape.TRI6:
      return [[0, 1], [1, 2], [2, 0]];
    case ElementShape.QUAD4:
    case ElementShape.QUAD8:
      return [[0, 1], [1, 2], [2, 3], [3, 0]];
    case ElementShape.TET4:
    case ElementShape.TET10:
      return [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    case ElementShape.HEX8:
    case ElementShape.HEX20:
      return [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
    case ElementShape.WEDGE6:
    case ElementShape.WEDGE15:
      return [
        [0, 1], [1, 2], [2, 0],
        [3, 4], [4, 5], [5, 3],
        [0, 3], [1, 4], [2, 5],
      ];
    default:
      return TOPOLOGIES[shape].edges;
  }
}

/**
 * Get corner-node-only faces for an element.
 * For 3D elements, returns the bounding quad/tri faces using only corner indices.
 */
export function getCornerFaces(shape: ElementShape): number[][] {
  switch (shape) {
    case ElementShape.TRI3:
    case ElementShape.TRI6:
      return [[0, 1, 2]];
    case ElementShape.QUAD4:
    case ElementShape.QUAD8:
      return [[0, 1, 2, 3]];
    case ElementShape.TET4:
    case ElementShape.TET10:
      return [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
    case ElementShape.HEX8:
    case ElementShape.HEX20:
      return [
        [0, 1, 2, 3], [4, 5, 6, 7],
        [0, 1, 5, 4], [1, 2, 6, 5],
        [2, 3, 7, 6], [3, 0, 4, 7],
      ];
    case ElementShape.WEDGE6:
    case ElementShape.WEDGE15:
      return [
        [0, 1, 2], [3, 4, 5],
        [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5],
      ];
    default:
      return TOPOLOGIES[shape].faces;
  }
}

// ─── Format-Specific Type Mapping ────────────────────────────────────────────

/**
 * Maps ANSYS MAPDL element type numbers (from ET command) to canonical shapes.
 * Key = MAPDL type reference number assigned via the ETYPE field in EBLOCK.
 * This is filled at parse time from the ET commands in the .cdb file.
 */
export const MAPDL_ELEMENT_MAP: Record<number, ElementShape> = {
  // MAPDL element type IDs (from KEYOPT usage)
  181: ElementShape.QUAD4,  // SHELL181 — 4-node structural shell
  163: ElementShape.QUAD4,  // SHELL163 — explicit 4-node shell
  185: ElementShape.HEX8,   // SOLID185 — 8-node structural solid
  186: ElementShape.HEX20,  // SOLID186 — 20-node structural solid
  187: ElementShape.TET10,  // SOLID187 — 10-node tet
  188: ElementShape.BEAM2,  // BEAM188 — 2-node beam
  189: ElementShape.BEAM3,  // BEAM189 — 3-node beam
};

/**
 * Maps Nastran card names to canonical shapes.
 */
export const NASTRAN_ELEMENT_MAP: Record<string, ElementShape> = {
  'CTRIA3': ElementShape.TRI3,
  'CTRIA6': ElementShape.TRI6,
  'CQUAD4': ElementShape.QUAD4,
  'CQUAD8': ElementShape.QUAD8,
  'CTETRA': ElementShape.TET4,   // 4-node by default
  'CTETRA10': ElementShape.TET10,
  'CHEXA': ElementShape.HEX8,    // 8-node by default
  'CHEXA20': ElementShape.HEX20,
  'CPENTA': ElementShape.WEDGE6,
  'CPENTA15': ElementShape.WEDGE15,
  'CBAR': ElementShape.BEAM2,
  'CBEAM': ElementShape.BEAM2,
};

/**
 * Maps Abaqus element type strings to canonical shapes.
 */
export const ABAQUS_ELEMENT_MAP: Record<string, ElementShape> = {
  // 2D shell elements
  'S3': ElementShape.TRI3,
  'S3R': ElementShape.TRI3,
  'STRI3': ElementShape.TRI3,
  'S4': ElementShape.QUAD4,
  'S4R': ElementShape.QUAD4,
  'S4RS': ElementShape.QUAD4,
  'S6': ElementShape.TRI6,
  'S8R': ElementShape.QUAD8,
  // 3D solid elements
  'C3D4': ElementShape.TET4,
  'C3D10': ElementShape.TET10,
  'C3D10M': ElementShape.TET10,
  'C3D8': ElementShape.HEX8,
  'C3D8R': ElementShape.HEX8,
  'C3D8I': ElementShape.HEX8,
  'C3D20': ElementShape.HEX20,
  'C3D20R': ElementShape.HEX20,
  'C3D6': ElementShape.WEDGE6,
  'C3D15': ElementShape.WEDGE15,
  // Beam elements
  'B31': ElementShape.BEAM2,
  'B32': ElementShape.BEAM3,
  'B31OS': ElementShape.BEAM2,
};

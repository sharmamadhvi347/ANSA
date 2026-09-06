/**
 * spatial-index.ts — Octree spatial index for fast proximity queries
 *
 * Used for:
 * - Duplicate node detection (range queries within tolerance)
 * - CAD surface proximity queries (Phase 2)
 * - Regional element selection for local diagnostics
 *
 * Builds from a NodeStore; supports insert, nearest-neighbor, and range queries.
 */

import { Vec3, NodeStore } from './mesh-model';

// ─── Octree Configuration ────────────────────────────────────────────────────

const MAX_DEPTH = 12;
const MAX_POINTS_PER_LEAF = 32;

// ─── Octree Node ─────────────────────────────────────────────────────────────

interface OctreePoint {
  id: number;
  x: number;
  y: number;
  z: number;
}

interface BoundingBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

class OctreeNode {
  bounds: BoundingBox;
  points: OctreePoint[];
  children: OctreeNode[] | null;
  depth: number;

  constructor(bounds: BoundingBox, depth: number) {
    this.bounds = bounds;
    this.points = [];
    this.children = null;
    this.depth = depth;
  }

  /** Check if a point is within the bounds */
  contains(x: number, y: number, z: number): boolean {
    return (
      x >= this.bounds.minX && x <= this.bounds.maxX &&
      y >= this.bounds.minY && y <= this.bounds.maxY &&
      z >= this.bounds.minZ && z <= this.bounds.maxZ
    );
  }

  /** Check if bounds intersect with a sphere */
  intersectsSphere(cx: number, cy: number, cz: number, radius: number): boolean {
    // Find closest point on the box to the sphere center
    const closestX = Math.max(this.bounds.minX, Math.min(cx, this.bounds.maxX));
    const closestY = Math.max(this.bounds.minY, Math.min(cy, this.bounds.maxY));
    const closestZ = Math.max(this.bounds.minZ, Math.min(cz, this.bounds.maxZ));

    const dx = closestX - cx;
    const dy = closestY - cy;
    const dz = closestZ - cz;

    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }

  /** Subdivide this node into 8 children */
  subdivide(): void {
    const { minX, minY, minZ, maxX, maxY, maxZ } = this.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const midZ = (minZ + maxZ) / 2;
    const d = this.depth + 1;

    this.children = [
      new OctreeNode({ minX, minY, minZ, maxX: midX, maxY: midY, maxZ: midZ }, d),
      new OctreeNode({ minX: midX, minY, minZ, maxX, maxY: midY, maxZ: midZ }, d),
      new OctreeNode({ minX, minY: midY, minZ, maxX: midX, maxY, maxZ: midZ }, d),
      new OctreeNode({ minX: midX, minY: midY, minZ, maxX, maxY, maxZ: midZ }, d),
      new OctreeNode({ minX, minY, minZ: midZ, maxX: midX, maxY: midY, maxZ }, d),
      new OctreeNode({ minX: midX, minY, minZ: midZ, maxX, maxY: midY, maxZ }, d),
      new OctreeNode({ minX, minY: midY, minZ: midZ, maxX: midX, maxY, maxZ }, d),
      new OctreeNode({ minX: midX, minY: midY, minZ: midZ, maxX, maxY, maxZ }, d),
    ];

    // Redistribute existing points to children
    for (const pt of this.points) {
      for (const child of this.children) {
        if (child.contains(pt.x, pt.y, pt.z)) {
          child.insert(pt);
          break;
        }
      }
    }
    this.points = [];
  }

  /** Insert a point into the octree */
  insert(point: OctreePoint): void {
    if (this.children) {
      for (const child of this.children) {
        if (child.contains(point.x, point.y, point.z)) {
          child.insert(point);
          return;
        }
      }
      // Edge case: point is exactly on boundary; insert in first child that can take it
      this.children[0].insert(point);
    } else {
      this.points.push(point);
      if (this.points.length > MAX_POINTS_PER_LEAF && this.depth < MAX_DEPTH) {
        this.subdivide();
      }
    }
  }

  /** Find all points within radius of (cx, cy, cz) */
  rangeQuery(cx: number, cy: number, cz: number, radius: number, results: OctreePoint[]): void {
    if (!this.intersectsSphere(cx, cy, cz, radius)) return;

    const r2 = radius * radius;

    if (this.children) {
      for (const child of this.children) {
        child.rangeQuery(cx, cy, cz, radius, results);
      }
    } else {
      for (const pt of this.points) {
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        const dz = pt.z - cz;
        if (dx * dx + dy * dy + dz * dz <= r2) {
          results.push(pt);
        }
      }
    }
  }

  /** Find the nearest point to (cx, cy, cz) */
  nearestQuery(
    cx: number, cy: number, cz: number,
    best: { point: OctreePoint | null; distSq: number },
  ): void {
    const bestRadius = Math.sqrt(best.distSq);
    if (!this.intersectsSphere(cx, cy, cz, bestRadius)) return;

    if (this.children) {
      // Sort children by distance to center for better pruning
      const sorted = this.children
        .map((child) => {
          const cMidX = (child.bounds.minX + child.bounds.maxX) / 2;
          const cMidY = (child.bounds.minY + child.bounds.maxY) / 2;
          const cMidZ = (child.bounds.minZ + child.bounds.maxZ) / 2;
          const dx = cMidX - cx, dy = cMidY - cy, dz = cMidZ - cz;
          return { child, dist: dx * dx + dy * dy + dz * dz };
        })
        .sort((a, b) => a.dist - b.dist);

      for (const { child } of sorted) {
        child.nearestQuery(cx, cy, cz, best);
      }
    } else {
      for (const pt of this.points) {
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        const dz = pt.z - cz;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < best.distSq) {
          best.distSq = distSq;
          best.point = pt;
        }
      }
    }
  }
}

// ─── SpatialIndex Public API ─────────────────────────────────────────────────

export class SpatialIndex {
  private root: OctreeNode;
  private pointCount: number = 0;

  constructor(bounds: BoundingBox) {
    // Add 1% padding to avoid boundary issues
    const padX = (bounds.maxX - bounds.minX) * 0.01 || 1;
    const padY = (bounds.maxY - bounds.minY) * 0.01 || 1;
    const padZ = (bounds.maxZ - bounds.minZ) * 0.01 || 1;
    this.root = new OctreeNode(
      {
        minX: bounds.minX - padX,
        minY: bounds.minY - padY,
        minZ: bounds.minZ - padZ,
        maxX: bounds.maxX + padX,
        maxY: bounds.maxY + padY,
        maxZ: bounds.maxZ + padZ,
      },
      0,
    );
  }

  /** Build from a NodeStore */
  static fromNodeStore(store: NodeStore): SpatialIndex {
    // First pass: compute bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const node of store) {
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.z < minZ) minZ = node.z;
      if (node.x > maxX) maxX = node.x;
      if (node.y > maxY) maxY = node.y;
      if (node.z > maxZ) maxZ = node.z;
    }

    const index = new SpatialIndex({ minX, minY, minZ, maxX, maxY, maxZ });

    // Second pass: insert points
    for (const node of store) {
      index.insert(node.id, node.x, node.y, node.z);
    }

    return index;
  }

  /** Insert a point */
  insert(id: number, x: number, y: number, z: number): void {
    this.root.insert({ id, x, y, z });
    this.pointCount++;
  }

  /** Find all points within `radius` of the given position */
  findInRadius(x: number, y: number, z: number, radius: number): Array<{ id: number; distance: number }> {
    const raw: OctreePoint[] = [];
    this.root.rangeQuery(x, y, z, radius, raw);
    return raw.map((pt) => ({
      id: pt.id,
      distance: Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2 + (pt.z - z) ** 2),
    }));
  }

  /** Find the nearest point to the given position */
  findNearest(x: number, y: number, z: number): { id: number; distance: number } | null {
    const best = { point: null as OctreePoint | null, distSq: Infinity };
    this.root.nearestQuery(x, y, z, best);
    if (!best.point) return null;
    return { id: best.point.id, distance: Math.sqrt(best.distSq) };
  }

  /**
   * Find duplicate nodes: nodes within `tolerance` of each other.
   * Returns groups of node IDs that are duplicates.
   */
  findDuplicates(store: NodeStore, tolerance: number): number[][] {
    const visited = new Set<number>();
    const groups: number[][] = [];

    for (const node of store) {
      if (visited.has(node.id)) continue;

      const nearby = this.findInRadius(node.x, node.y, node.z, tolerance);
      const group = nearby
        .filter((n) => n.id !== node.id && !visited.has(n.id))
        .map((n) => n.id);

      if (group.length > 0) {
        const fullGroup = [node.id, ...group];
        fullGroup.forEach((id) => visited.add(id));
        groups.push(fullGroup);
      } else {
        visited.add(node.id);
      }
    }

    return groups;
  }

  get size(): number {
    return this.pointCount;
  }
}

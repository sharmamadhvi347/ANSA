import { MeshModel, Vec3 } from './mesh-model';
import { CadKernel } from './cad-kernel';

/**
 * Moves a node to the nearest surface on the loaded CAD model.
 * @param model The mesh model
 * @param nodeId The node to move
 * @param cadKernel The CAD kernel instance containing the CAD geometry
 * @returns true if the node was moved, false if the node doesn't exist or projection failed
 */
export function projectNodeToCad(model: MeshModel, nodeId: number, cadKernel: CadKernel): boolean {
  const currentPos = model.nodes.getNode(nodeId);
  if (!currentPos) return false;

  const nearest = cadKernel.nearestSurfacePoint([currentPos.x, currentPos.y, currentPos.z]);
  if (nearest) {
    model.nodes.setNode(nodeId, nearest.point[0], nearest.point[1], nearest.point[2]);
    return true;
  }
  return false;
}

/**
 * Moves a node to the geometric centroid of its connected neighbors.
 * Useful for improving aspect ratio or skewness.
 * @param model The mesh model
 * @param nodeId The node to smooth
 * @returns true if smoothed, false if no neighbors found
 */
export function laplacianSmooth(model: MeshModel, nodeId: number): boolean {
  const pos = model.nodes.getNode(nodeId);
  if (!pos) return false;

  // Find all elements using this node to find connected neighbors
  const elemIds = model.elements.getElementsUsingNode(nodeId);
  if (elemIds.length === 0) return false;

  const neighborIds = new Set<number>();
  for (const eid of elemIds) {
    const elem = model.elements.getElement(eid);
    if (elem) {
      for (const nid of elem.nodeIds) {
        if (nid !== nodeId) {
          neighborIds.add(nid);
        }
      }
    }
  }

  if (neighborIds.size === 0) return false;

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const nid of neighborIds) {
    const npos = model.nodes.getNode(nid);
    if (npos) {
      sumX += npos.x;
      sumY += npos.y;
      sumZ += npos.z;
    }
  }

  model.nodes.setNode(
    nodeId,
    sumX / neighborIds.size,
    sumY / neighborIds.size,
    sumZ / neighborIds.size
  );
  return true;
}

/**
 * Merges node B into node A, updating all elements that used node B to use node A,
 * and removes node B from the model.
 * @param model The mesh model
 * @param nodeA The node to keep
 * @param nodeB The node to remove
 * @returns true if successful
 */
export function mergeNodes(model: MeshModel, nodeA: number, nodeB: number): boolean {
  if (!model.nodes.hasNode(nodeA) || !model.nodes.hasNode(nodeB)) return false;

  // Find elements using node B
  const elemIds = model.elements.getElementsUsingNode(nodeB);
  for (const eid of elemIds) {
    const elem = model.elements.getElement(eid);
    if (elem) {
      // Replace node B with node A in connectivity
      for (let i = 0; i < elem.nodeIds.length; i++) {
        if (elem.nodeIds[i] === nodeB) {
          elem.nodeIds[i] = nodeA;
        }
      }
    }
  }

  // Remove node B
  model.nodes.removeNode(nodeB);
  return true;
}

/**
 * Removes all nodes that are not referenced by any element.
 * @param model The mesh model
 * @returns The number of nodes removed
 */
export function removeUnreferencedNodes(model: MeshModel): number {
  const referenced = model.getReferencedNodeIds();
  let removedCount = 0;
  
  for (const nodeId of model.nodes.ids) {
    if (!referenced.has(nodeId)) {
      model.nodes.removeNode(nodeId);
      removedCount++;
    }
  }
  
  return removedCount;
}

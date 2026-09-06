/**
 * Parser round-trip tests — parse fixture files, write them back,
 * re-parse, and verify node coords + element connectivity match.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Import parsers (self-registering)
import '../../src/parsers/cdb-parser';
import '../../src/parsers/cdb-writer';
import '../../src/parsers/inp-parser';
import '../../src/parsers/inp-writer';
import '../../src/parsers/bdf-parser';
import '../../src/parsers/bdf-writer';

import { getParserForFile, getWriterForExtension } from '../../src/parsers/parser-registry';
import { MeshModel } from '../../src/core/mesh-model';

const FIXTURES_DIR = path.join(__dirname, '../fixtures');

function readFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
}

/** Compare two models for equality within tolerance */
function assertModelsEqual(a: MeshModel, b: MeshModel, coordTol: number = 1e-6): void {
  // Same number of nodes
  expect(a.nodes.count).toBe(b.nodes.count);

  // Same number of elements
  expect(a.elements.count).toBe(b.elements.count);

  // Node coordinates match within tolerance
  for (const nodeA of a.nodes) {
    const nodeB = b.nodes.getNode(nodeA.id);
    expect(nodeB).not.toBeNull();
    if (nodeB) {
      expect(Math.abs(nodeA.x - nodeB.x)).toBeLessThan(coordTol);
      expect(Math.abs(nodeA.y - nodeB.y)).toBeLessThan(coordTol);
      expect(Math.abs(nodeA.z - nodeB.z)).toBeLessThan(coordTol);
    }
  }

  // Element connectivity matches exactly
  for (const elemA of a.elements) {
    const elemB = b.elements.getElement(elemA.id);
    expect(elemB).toBeDefined();
    if (elemB) {
      expect(elemA.nodeIds).toEqual(elemB.nodeIds);
      expect(elemA.shape).toBe(elemB.shape);
    }
  }
}

// ─── CDB Round-Trip Tests ───────────────────────────────────────────────────

describe('CDB Parser + Writer', () => {
  it('should parse the simple quad fixture', () => {
    const content = readFixture('simple_quad.cdb');
    const parser = getParserForFile('test.cdb');
    expect(parser).not.toBeNull();

    const model = parser!.parse(content, 'simple_quad.cdb');

    expect(model.nodes.count).toBe(9);
    expect(model.elements.count).toBe(4);
    expect(model.metadata.sourceFormat).toBe('cdb');

    // Check specific node
    const node1 = model.nodes.getNode(1);
    expect(node1).toEqual({ x: 0, y: 0, z: 0 });

    const node5 = model.nodes.getNode(5);
    expect(node5).toEqual({ x: 1, y: 1, z: 0 });

    const node9 = model.nodes.getNode(9);
    expect(node9).toEqual({ x: 2, y: 2, z: 0 });
  });

  it('should round-trip CDB: parse → write → re-parse with matching data', () => {
    const content = readFixture('simple_quad.cdb');
    const parser = getParserForFile('test.cdb')!;
    const writer = getWriterForExtension('.cdb')!;

    const model1 = parser.parse(content);
    const written = writer.write(model1);
    const model2 = parser.parse(written);

    assertModelsEqual(model1, model2);
  });

  it('should preserve component information', () => {
    const content = readFixture('simple_quad.cdb');
    const parser = getParserForFile('test.cdb')!;
    const model = parser.parse(content);

    expect(model.components.has('SHELL_PART')).toBe(true);
    const comp = model.components.get('SHELL_PART')!;
    expect(comp.elementIds.size).toBe(4);
  });
});

// ─── INP Round-Trip Tests ───────────────────────────────────────────────────

describe('INP Parser + Writer', () => {
  it('should parse the simple quad fixture', () => {
    const content = readFixture('simple_quad.inp');
    const parser = getParserForFile('test.inp');
    expect(parser).not.toBeNull();

    const model = parser!.parse(content, 'simple_quad.inp');

    expect(model.nodes.count).toBe(9);
    expect(model.elements.count).toBe(4);
    expect(model.metadata.sourceFormat).toBe('inp');

    const node1 = model.nodes.getNode(1);
    expect(node1).toEqual({ x: 0, y: 0, z: 0 });

    const node9 = model.nodes.getNode(9);
    expect(node9).toEqual({ x: 2, y: 2, z: 0 });
  });

  it('should round-trip INP: parse → write → re-parse with matching data', () => {
    const content = readFixture('simple_quad.inp');
    const parser = getParserForFile('test.inp')!;
    const writer = getWriterForExtension('.inp')!;

    const model1 = parser.parse(content);
    const written = writer.write(model1);
    const model2 = parser.parse(written);

    assertModelsEqual(model1, model2);
  });
});

// ─── BDF Round-Trip Tests ───────────────────────────────────────────────────

describe('BDF Parser + Writer', () => {
  it('should parse the simple quad fixture', () => {
    const content = readFixture('simple_quad.bdf');
    const parser = getParserForFile('test.bdf');
    expect(parser).not.toBeNull();

    const model = parser!.parse(content, 'simple_quad.bdf');

    expect(model.nodes.count).toBe(9);
    expect(model.elements.count).toBe(4);
    expect(model.metadata.sourceFormat).toBe('bdf');

    const node1 = model.nodes.getNode(1);
    expect(node1).toEqual({ x: 0, y: 0, z: 0 });

    const node9 = model.nodes.getNode(9);
    expect(node9).toEqual({ x: 2, y: 2, z: 0 });

    // Check element connectivity
    const elem1 = model.elements.getElement(1);
    expect(elem1).toBeDefined();
    expect(elem1!.nodeIds).toEqual([1, 2, 5, 4]);
    expect(elem1!.shape).toBe('QUAD4');
  });

  it('should round-trip BDF: parse → write → re-parse with matching data', () => {
    const content = readFixture('simple_quad.bdf');
    const parser = getParserForFile('test.bdf')!;
    const writer = getWriterForExtension('.bdf')!;

    const model1 = parser.parse(content);
    const written = writer.write(model1);
    const model2 = parser.parse(written);

    assertModelsEqual(model1, model2);
  });
});

// ─── Cross-Format Compatibility ─────────────────────────────────────────────

describe('Cross-Format Compatibility', () => {
  it('should produce equivalent models from the same mesh in different formats', () => {
    const cdbParser = getParserForFile('test.cdb')!;
    const inpParser = getParserForFile('test.inp')!;
    const bdfParser = getParserForFile('test.bdf')!;

    const cdbModel = cdbParser.parse(readFixture('simple_quad.cdb'));
    const inpModel = inpParser.parse(readFixture('simple_quad.inp'));
    const bdfModel = bdfParser.parse(readFixture('simple_quad.bdf'));

    // All three should have the same node/element counts
    expect(cdbModel.nodes.count).toBe(inpModel.nodes.count);
    expect(cdbModel.nodes.count).toBe(bdfModel.nodes.count);
    expect(cdbModel.elements.count).toBe(inpModel.elements.count);
    expect(cdbModel.elements.count).toBe(bdfModel.elements.count);

    // Node coordinates should match across all formats
    for (const cdbNode of cdbModel.nodes) {
      const inpNode = inpModel.nodes.getNode(cdbNode.id);
      const bdfNode = bdfModel.nodes.getNode(cdbNode.id);

      expect(inpNode).not.toBeNull();
      expect(bdfNode).not.toBeNull();

      if (inpNode) {
        expect(Math.abs(cdbNode.x - inpNode.x)).toBeLessThan(1e-6);
        expect(Math.abs(cdbNode.y - inpNode.y)).toBeLessThan(1e-6);
        expect(Math.abs(cdbNode.z - inpNode.z)).toBeLessThan(1e-6);
      }
      if (bdfNode) {
        expect(Math.abs(cdbNode.x - bdfNode.x)).toBeLessThan(1e-6);
        expect(Math.abs(cdbNode.y - bdfNode.y)).toBeLessThan(1e-6);
        expect(Math.abs(cdbNode.z - bdfNode.z)).toBeLessThan(1e-6);
      }
    }
  });
});

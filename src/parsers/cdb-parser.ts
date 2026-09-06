/**
 * cdb-parser.ts — ANSYS MAPDL .cdb (Coded Database) importer
 *
 * Parses the blocked format produced by CDWRITE,DB:
 * - ET commands (element type definitions)
 * - NBLOCK (node coordinates in Fortran fixed-width format)
 * - EBLOCK (element connectivity with full attribute fields)
 * - CMBLOCK (component/named selection blocks)
 *
 * Preserves all element attributes (MAT, REAL, SECNUM, ESYS, TYPE) for
 * lossless round-trip back to .cdb via cdb-writer.
 */

import {
  MeshModel, MeshFormat, MeshElement, defaultElementAttributes,
} from '../core/mesh-model';
import { ElementShape, MAPDL_ELEMENT_MAP } from '../core/element-types';
import { MeshParser, registerParser } from './parser-registry';

// ─── MAPDL Element Type Definitions ──────────────────────────────────────────

interface ETypeDefinition {
  /** ET reference number (used in EBLOCK TYPE field) */
  typeRef: number;
  /** MAPDL element type number (e.g., 181 for SHELL181) */
  typeId: number;
  /** Key options from KEYOPT commands */
  keyopts: Record<number, number>;
}

// ─── Fortran Format String Parser ────────────────────────────────────────────

interface FormatField {
  type: 'integer' | 'float' | 'string';
  width: number;
  repeat: number;
  decimals?: number;
}

/**
 * Parse a Fortran format string like "(3i9,6e20.13)" into field descriptors.
 * Used for NBLOCK and EBLOCK data lines.
 */
function parseFortranFormat(formatStr: string): FormatField[] {
  const fields: FormatField[] = [];
  // Remove outer parens and spaces
  const inner = formatStr.replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();
  // Match patterns like "3i9", "6e20.13", "i9", "e20.13", "a8"
  const regex = /(\d+)?([ieafg])(\d+)(?:\.(\d+))?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(inner)) !== null) {
    const repeat = match[1] ? parseInt(match[1], 10) : 1;
    const typeChar = match[2].toLowerCase();
    const width = parseInt(match[3], 10);
    const decimals = match[4] ? parseInt(match[4], 10) : undefined;

    let type: FormatField['type'];
    if (typeChar === 'i') type = 'integer';
    else if (typeChar === 'a') type = 'string';
    else type = 'float';

    fields.push({ type, width, repeat, decimals });
  }

  return fields;
}

/**
 * Read fixed-width fields from a line according to Fortran format descriptors.
 */
function readFixedWidthFields(line: string, fields: FormatField[]): (number | string)[] {
  const values: (number | string)[] = [];
  let pos = 0;

  for (const field of fields) {
    for (let r = 0; r < field.repeat; r++) {
      if (pos >= line.length) {
        // Pad with zeros/empty for short lines
        values.push(field.type === 'string' ? '' : 0);
        continue;
      }

      const raw = line.substring(pos, pos + field.width).trim();
      pos += field.width;

      if (field.type === 'string') {
        values.push(raw);
      } else if (field.type === 'integer') {
        values.push(raw === '' ? 0 : parseInt(raw, 10));
      } else {
        // Handle Fortran-style floats (e.g., "1.234D+02" → "1.234E+02")
        const normalized = raw.replace(/[dD]/, 'E');
        values.push(normalized === '' ? 0 : parseFloat(normalized));
      }
    }
  }

  return values;
}

// ─── CDB Parser Implementation ──────────────────────────────────────────────

function parseCdb(content: string, filename?: string): MeshModel {
  const model = new MeshModel();
  model.metadata.sourceFormat = MeshFormat.CDB;
  model.metadata.sourceFilePath = filename;

  const lines = content.split(/\r?\n/);
  const etDefs: Map<number, ETypeDefinition> = new Map();
  const keyopts: Map<number, Record<number, number>> = new Map();

  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // ─── Title ─────────────────────────────────────────────────────────
    if (line.startsWith('/TITLE')) {
      const parts = line.split(',');
      if (parts.length > 1) {
        model.metadata.title = parts.slice(1).join(',').trim();
      }
      i++;
      continue;
    }

    // ─── ET command (Element Type definition) ──────────────────────────
    if (/^ET\s*,/i.test(line)) {
      const parts = line.split(',').map((s) => s.trim());
      const typeRef = parseInt(parts[1], 10);
      const typeId = parseInt(parts[2], 10);
      if (!isNaN(typeRef) && !isNaN(typeId)) {
        const existing = etDefs.get(typeRef);
        etDefs.set(typeRef, {
          typeRef,
          typeId,
          keyopts: existing?.keyopts || {},
        });
      }
      i++;
      continue;
    }

    // ─── KEYOPT command ────────────────────────────────────────────────
    if (/^KEYOPT\s*,/i.test(line)) {
      const parts = line.split(',').map((s) => s.trim());
      const typeRef = parseInt(parts[1], 10);
      const knum = parseInt(parts[2], 10);
      const kval = parseInt(parts[3], 10);
      if (!isNaN(typeRef) && !isNaN(knum) && !isNaN(kval)) {
        if (!keyopts.has(typeRef)) keyopts.set(typeRef, {});
        keyopts.get(typeRef)![knum] = kval;
      }
      i++;
      continue;
    }

    // ─── NBLOCK (Node Block) ───────────────────────────────────────────
    if (/^NBLOCK/i.test(line)) {
      i++;
      // Next line is the Fortran format string
      const formatLine = lines[i]?.trim() || '';
      const fields = parseFortranFormat(formatLine);
      i++;

      // Read node data until we hit N,-1 or end-of-block
      while (i < lines.length) {
        const nodeLine = lines[i];
        // Terminator: line starting with -1 or "N" command
        if (nodeLine.trim() === '-1' || /^\s*-1\s*$/.test(nodeLine) || /^N\b/i.test(nodeLine.trim())) {
          i++;
          break;
        }

        const values = readFixedWidthFields(nodeLine, fields);
        // NBLOCK format: nodeId, solidModelRef, lineRef, x, y, z [, rotx, roty, rotz]
        // With 3 integer fields + 6 float fields typically: (3i9,6e20.13)
        if (values.length >= 4) {
          const nodeId = values[0] as number;
          // Fields 1,2 are solid model entity ref and line location (skip)
          const x = (values.length >= 6) ? values[3] as number : 0;
          const y = (values.length >= 6) ? values[4] as number : 0;
          const z = (values.length >= 6) ? values[5] as number : 0;
          if (nodeId > 0) {
            model.nodes.addNode(nodeId, x, y, z);
          }
        }

        i++;
      }
      continue;
    }

    // ─── EBLOCK (Element Block) ────────────────────────────────────────
    if (/^EBLOCK/i.test(line)) {
      // Parse EBLOCK header for number of fields
      const headerParts = line.split(',').map((s) => s.trim());
      const numFields = parseInt(headerParts[1], 10) || 19;
      i++;

      // Next line is the Fortran format string
      const formatLine = lines[i]?.trim() || '';
      const fields = parseFortranFormat(formatLine);
      i++;

      // Read element data
      while (i < lines.length) {
        const elemLine = lines[i];
        if (elemLine.trim() === '-1' || /^\s*-1\s*$/.test(elemLine)) {
          i++;
          break;
        }

        const values = readFixedWidthFields(elemLine, fields);
        // EBLOCK 19 fields per element:
        // [0] MAT, [1] TYPE, [2] REAL, [3] SECNUM, [4] ESYS,
        // [5] DEATH, [6] SOLIDMODEL, [7] SHAPE, [8] NUMNODE,
        // [9] notused, [10] ELNUM, [11..] nodes
        if (values.length >= 12) {
          const mat = values[0] as number;
          const typeRef = values[1] as number;
          const real = values[2] as number;
          const secnum = values[3] as number;
          const esys = values[4] as number;
          const numNodes = values[8] as number;
          const elemId = values[10] as number;

          if (elemId <= 0) {
            i++;
            continue;
          }

          // Collect node IDs (may span multiple lines for high-order elements)
          const nodeIds: number[] = [];
          let startIdx = 11;
          for (let n = startIdx; n < values.length && nodeIds.length < numNodes; n++) {
            const nid = values[n] as number;
            if (nid > 0) nodeIds.push(nid);
          }

          // If we need more nodes (element has > 8 nodes), read continuation line
          while (nodeIds.length < numNodes && i + 1 < lines.length) {
            i++;
            const contLine = lines[i];
            if (contLine.trim() === '-1' || /^\s*-1\s*$/.test(contLine)) break;
            const contValues = readFixedWidthFields(contLine, fields);
            for (const v of contValues) {
              if (nodeIds.length >= numNodes) break;
              const nid = v as number;
              if (nid > 0) nodeIds.push(nid);
            }
          }

          // Determine canonical element shape
          const etDef = etDefs.get(typeRef);
          let shape = ElementShape.QUAD4; // default fallback
          if (etDef) {
            const mapped = MAPDL_ELEMENT_MAP[etDef.typeId];
            if (mapped) {
              shape = mapped;
            } else {
              // Infer from node count
              shape = inferShapeFromNodeCount(numNodes);
            }
          } else {
            shape = inferShapeFromNodeCount(numNodes);
          }

          const element: MeshElement = {
            id: elemId,
            shape,
            nodeIds,
            componentName: '',
            attrs: {
              materialId: mat,
              realConstantId: real,
              sectionId: secnum,
              coordinateSystemId: esys,
              formatTypeRef: typeRef,
              propertyId: 0,
            },
          };

          model.elements.addElement(element);
        }

        i++;
      }
      continue;
    }

    // ─── CMBLOCK (Component Block) ─────────────────────────────────────
    if (/^CMBLOCK/i.test(line)) {
      const parts = line.split(',').map((s) => s.trim());
      const compName = parts[1] || 'unnamed';
      const compType = (parts[2] || 'NODE').toUpperCase();
      const numEntities = parseInt(parts[3], 10) || 0;
      i++;

      // Next line is format string
      const formatLine = lines[i]?.trim() || '';
      const fields = parseFortranFormat(formatLine);
      i++;

      // Read entity IDs
      const entityIds: number[] = [];
      while (i < lines.length && entityIds.length < numEntities) {
        const dataLine = lines[i];
        const values = readFixedWidthFields(dataLine, fields);
        for (const v of values) {
          const id = v as number;
          if (id > 0) entityIds.push(id);
          else if (id === 0) break; // end of data
        }
        i++;
      }

      // Create component
      const info = {
        name: compName,
        elementIds: new Set<number>(),
        nodeIds: new Set<number>(),
        originalType: compType,
      };

      if (compType === 'ELEMENT' || compType === 'ELEM') {
        info.elementIds = new Set(entityIds);
        // Tag elements with this component name
        for (const eid of entityIds) {
          const elem = model.elements.getElement(eid);
          if (elem) elem.componentName = compName;
        }
      } else if (compType === 'NODE') {
        info.nodeIds = new Set(entityIds);
      }

      model.components.set(compName, info);
      continue;
    }

    i++;
  }

  // Merge keyopts into ET definitions
  for (const [typeRef, ko] of keyopts) {
    const etDef = etDefs.get(typeRef);
    if (etDef) {
      Object.assign(etDef.keyopts, ko);
    }
  }

  // Store ET definitions in metadata for round-trip
  model.metadata.formatExtras['etDefinitions'] = Object.fromEntries(
    Array.from(etDefs.entries()).map(([k, v]) => [k.toString(), v])
  );

  return model;
}

/** Infer element shape from node count when type info is unavailable */
function inferShapeFromNodeCount(nodeCount: number): ElementShape {
  switch (nodeCount) {
    case 1: return ElementShape.POINT;
    case 2: return ElementShape.BEAM2;
    case 3: return ElementShape.TRI3;
    case 4: return ElementShape.QUAD4; // Could also be TET4, but shell is more common
    case 6: return ElementShape.TRI6;  // Could be WEDGE6 for solids
    case 8: return ElementShape.HEX8;
    case 10: return ElementShape.TET10;
    case 15: return ElementShape.WEDGE15;
    case 20: return ElementShape.HEX20;
    default: return ElementShape.QUAD4;
  }
}

// ─── Register Parser ─────────────────────────────────────────────────────────

export const cdbParser: MeshParser = {
  formatName: 'ANSYS CDB',
  extensions: ['.cdb'],
  parse: parseCdb,
};

registerParser(cdbParser);

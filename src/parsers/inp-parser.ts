/**
 * inp-parser.ts — Abaqus .inp file importer
 *
 * Parses keyword-driven Abaqus input files:
 * - *NODE (node coordinates)
 * - *ELEMENT, TYPE=xxx (element connectivity)
 * - *NSET, *ELSET (node/element sets)
 * - *PART, *INSTANCE, *ASSEMBLY hierarchy
 * - *SOLID SECTION, *SHELL SECTION (section properties)
 * - ** comment lines
 */

import {
  MeshModel, MeshFormat, MeshElement, defaultElementAttributes,
} from '../core/mesh-model';
import { ElementShape, ABAQUS_ELEMENT_MAP } from '../core/element-types';
import { MeshParser, registerParser } from './parser-registry';

// ─── Keyword Parsing Helpers ─────────────────────────────────────────────────

interface KeywordLine {
  keyword: string;
  params: Map<string, string>;
}

/**
 * Parse an Abaqus keyword line like "*ELEMENT, TYPE=C3D8R, ELSET=MySet"
 * into { keyword: "ELEMENT", params: Map{ TYPE→"C3D8R", ELSET→"MySet" } }
 */
function parseKeywordLine(line: string): KeywordLine | null {
  if (!line.startsWith('*') || line.startsWith('**')) return null;

  const parts = line.substring(1).split(',').map((s) => s.trim());
  const keyword = parts[0].toUpperCase();
  const params = new Map<string, string>();

  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=');
    if (eqIdx >= 0) {
      const key = parts[i].substring(0, eqIdx).trim().toUpperCase();
      const val = parts[i].substring(eqIdx + 1).trim();
      params.set(key, val);
    } else {
      // Positional parameter
      params.set(parts[i].trim().toUpperCase(), '');
    }
  }

  return { keyword, params };
}

/**
 * Parse a comma-separated data line into numbers.
 * Handles trailing commas and whitespace.
 */
function parseDataLine(line: string): number[] {
  return line
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => parseFloat(s));
}

// ─── INP Parser Implementation ──────────────────────────────────────────────

function parseInp(content: string, filename?: string): MeshModel {
  const model = new MeshModel();
  model.metadata.sourceFormat = MeshFormat.INP;
  model.metadata.sourceFilePath = filename;

  const lines = content.split(/\r?\n/);
  let i = 0;
  let currentPartName = '';
  let nodeIdOffset = 0;
  let elemIdOffset = 0;

  // Track section assignments for metadata
  const sectionAssignments: Array<{ elset: string; material: string; type: string }> = [];

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (line === '' || line.startsWith('**')) {
      i++;
      continue;
    }

    const kw = parseKeywordLine(line);

    if (!kw) {
      // Data line outside any keyword context — skip
      i++;
      continue;
    }

    switch (kw.keyword) {
      // ─── Heading ───────────────────────────────────────────────────
      case 'HEADING': {
        i++;
        if (i < lines.length && !lines[i].trim().startsWith('*')) {
          model.metadata.title = lines[i].trim();
          i++;
        }
        break;
      }

      // ─── Part/Instance/Assembly ────────────────────────────────────
      case 'PART': {
        currentPartName = kw.params.get('NAME') || 'Part-1';
        i++;
        break;
      }
      case 'END PART': {
        currentPartName = '';
        i++;
        break;
      }
      case 'INSTANCE': {
        currentPartName = kw.params.get('NAME') || currentPartName;
        i++;
        break;
      }
      case 'END INSTANCE':
      case 'ASSEMBLY':
      case 'END ASSEMBLY': {
        i++;
        break;
      }

      // ─── Nodes ─────────────────────────────────────────────────────
      case 'NODE': {
        const nsetName = kw.params.get('NSET');
        const nsetIds: number[] = [];
        i++;

        while (i < lines.length) {
          const dataLine = lines[i].trim();
          if (dataLine === '' || dataLine.startsWith('*')) break;

          const vals = parseDataLine(dataLine);
          if (vals.length >= 4) {
            const nodeId = Math.round(vals[0]) + nodeIdOffset;
            model.nodes.addNode(nodeId, vals[1], vals[2], vals[3]);
            if (nsetName) nsetIds.push(nodeId);
          } else if (vals.length === 1) {
            // Just a node ID (used in node set definitions sometimes)
            break;
          }
          i++;
        }

        if (nsetName && nsetIds.length > 0) {
          const existing = model.components.get(nsetName);
          if (existing) {
            nsetIds.forEach((id) => existing.nodeIds.add(id));
          } else {
            model.components.set(nsetName, {
              name: nsetName,
              elementIds: new Set(),
              nodeIds: new Set(nsetIds),
              originalType: 'NODE',
            });
          }
        }
        break;
      }

      // ─── Elements ──────────────────────────────────────────────────
      case 'ELEMENT': {
        const typeStr = kw.params.get('TYPE') || 'C3D8';
        const elsetName = kw.params.get('ELSET') || currentPartName;
        const shape = ABAQUS_ELEMENT_MAP[typeStr.toUpperCase()] || ElementShape.HEX8;
        const elsetIds: number[] = [];

        // Store the Abaqus type string for round-trip
        if (!model.metadata.formatExtras['elementTypes']) {
          model.metadata.formatExtras['elementTypes'] = {};
        }

        i++;

        while (i < lines.length) {
          const dataLine = lines[i].trim();
          if (dataLine === '' || dataLine.startsWith('*')) break;

          // Element data may span multiple lines (continuation)
          let fullLine = dataLine;
          // Check if line ends with comma (continuation)
          while (fullLine.endsWith(',') && i + 1 < lines.length) {
            i++;
            const contLine = lines[i].trim();
            if (contLine.startsWith('*')) break;
            fullLine += contLine;
          }

          const vals = parseDataLine(fullLine);
          if (vals.length >= 2) {
            const elemId = Math.round(vals[0]) + elemIdOffset;
            const nodeIds = vals.slice(1).map((v) => Math.round(v) + nodeIdOffset);

            const element: MeshElement = {
              id: elemId,
              shape,
              nodeIds,
              componentName: elsetName,
              attrs: {
                ...defaultElementAttributes(),
                formatTypeRef: 0,
                propertyId: 0,
              },
            };

            // Store original Abaqus type for this element
            (model.metadata.formatExtras['elementTypes'] as Record<string, string>)[elemId.toString()] = typeStr;

            model.elements.addElement(element);
            elsetIds.push(elemId);
          }
          i++;
        }

        // Create/update elset component
        if (elsetName && elsetIds.length > 0) {
          const existing = model.components.get(elsetName);
          if (existing) {
            elsetIds.forEach((id) => existing.elementIds.add(id));
          } else {
            model.components.set(elsetName, {
              name: elsetName,
              elementIds: new Set(elsetIds),
              nodeIds: new Set(),
              originalType: 'ELEMENT',
            });
          }
        }
        break;
      }

      // ─── Node Sets ─────────────────────────────────────────────────
      case 'NSET': {
        const nsetName = kw.params.get('NSET') || 'unnamed';
        const generate = kw.params.has('GENERATE');
        const nsetIds: number[] = [];
        i++;

        while (i < lines.length) {
          const dataLine = lines[i].trim();
          if (dataLine === '' || dataLine.startsWith('*')) break;

          const vals = parseDataLine(dataLine);
          if (generate && vals.length >= 2) {
            const start = Math.round(vals[0]);
            const end = Math.round(vals[1]);
            const step = vals.length >= 3 ? Math.round(vals[2]) : 1;
            for (let j = start; j <= end; j += step) {
              nsetIds.push(j + nodeIdOffset);
            }
          } else {
            vals.forEach((v) => nsetIds.push(Math.round(v) + nodeIdOffset));
          }
          i++;
        }

        const existing = model.components.get(nsetName);
        if (existing) {
          nsetIds.forEach((id) => existing.nodeIds.add(id));
        } else {
          model.components.set(nsetName, {
            name: nsetName,
            elementIds: new Set(),
            nodeIds: new Set(nsetIds),
            originalType: 'NODE',
          });
        }
        break;
      }

      // ─── Element Sets ──────────────────────────────────────────────
      case 'ELSET': {
        const elsetName = kw.params.get('ELSET') || 'unnamed';
        const generate = kw.params.has('GENERATE');
        const elsetIds: number[] = [];
        i++;

        while (i < lines.length) {
          const dataLine = lines[i].trim();
          if (dataLine === '' || dataLine.startsWith('*')) break;

          const vals = parseDataLine(dataLine);
          if (generate && vals.length >= 2) {
            const start = Math.round(vals[0]);
            const end = Math.round(vals[1]);
            const step = vals.length >= 3 ? Math.round(vals[2]) : 1;
            for (let j = start; j <= end; j += step) {
              elsetIds.push(j + elemIdOffset);
            }
          } else {
            vals.forEach((v) => elsetIds.push(Math.round(v) + elemIdOffset));
          }
          i++;
        }

        const existing = model.components.get(elsetName);
        if (existing) {
          elsetIds.forEach((id) => existing.elementIds.add(id));
        } else {
          model.components.set(elsetName, {
            name: elsetName,
            elementIds: new Set(elsetIds),
            nodeIds: new Set(),
            originalType: 'ELEMENT',
          });
        }

        // Tag elements with component name
        for (const eid of elsetIds) {
          const elem = model.elements.getElement(eid);
          if (elem && !elem.componentName) {
            elem.componentName = elsetName;
          }
        }
        break;
      }

      // ─── Section Properties ────────────────────────────────────────
      case 'SOLID SECTION':
      case 'SHELL SECTION': {
        const elset = kw.params.get('ELSET') || '';
        const material = kw.params.get('MATERIAL') || '';
        sectionAssignments.push({
          elset,
          material,
          type: kw.keyword,
        });
        i++;
        // Skip data lines
        while (i < lines.length && !lines[i].trim().startsWith('*') && lines[i].trim() !== '') {
          i++;
        }
        break;
      }

      // ─── Material (preserve for round-trip) ────────────────────────
      case 'MATERIAL': {
        const matName = kw.params.get('NAME') || '';
        if (!model.metadata.formatExtras['materials']) {
          model.metadata.formatExtras['materials'] = [];
        }
        (model.metadata.formatExtras['materials'] as string[]).push(matName);
        i++;
        break;
      }

      default: {
        // Skip unknown keywords and their data lines
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('*') && lines[i].trim() !== '') {
          i++;
        }
        break;
      }
    }
  }

  // Store section assignments for round-trip
  model.metadata.formatExtras['sectionAssignments'] = sectionAssignments;

  return model;
}

// ─── Register Parser ─────────────────────────────────────────────────────────

export const inpParser: MeshParser = {
  formatName: 'Abaqus INP',
  extensions: ['.inp'],
  parse: parseInp,
};

registerParser(inpParser);

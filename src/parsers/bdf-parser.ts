/**
 * bdf-parser.ts — Nastran BDF/NAS bulk data file importer
 *
 * Parses Nastran Bulk Data Files in three formats:
 * - Small field (8-character fields, 10 fields per card)
 * - Large field (16-character fields, indicated by * suffix)
 * - Free field (comma-separated)
 *
 * Supported cards:
 * - GRID (node coordinates)
 * - CQUAD4, CTRIA3, CTETRA, CHEXA, CPENTA, CBAR, CBEAM (elements)
 * - PSHELL, PSOLID (property cards — preserved for round-trip)
 * - $ comment lines
 */

import {
  MeshModel, MeshFormat, MeshElement, defaultElementAttributes,
} from '../core/mesh-model';
import { ElementShape, NASTRAN_ELEMENT_MAP } from '../core/element-types';
import { MeshParser, registerParser } from './parser-registry';

// ─── Card Parsing ────────────────────────────────────────────────────────────

interface BdfCard {
  name: string;
  fields: string[];
}

/**
 * Parse a BDF card (potentially spanning multiple lines via continuation).
 * Returns the card name and all fields as strings.
 */
function parseCard(lines: string[], startIdx: number): { card: BdfCard | null; linesConsumed: number } {
  const line = lines[startIdx];

  // Skip empty lines and comments
  if (!line || line.trim() === '' || line.trim().startsWith('$')) {
    return { card: null, linesConsumed: 1 };
  }

  // Check for free-field format (contains commas)
  if (line.includes(',')) {
    return parseFreeFieldCard(lines, startIdx);
  }

  // Check for large-field format (card name ends with *)
  const trimmedName = line.substring(0, 8).trim();
  if (trimmedName.endsWith('*')) {
    return parseLargeFieldCard(lines, startIdx);
  }

  // Small field format
  return parseSmallFieldCard(lines, startIdx);
}

/** Parse a small-field card (8-char fields, 10 per line) */
function parseSmallFieldCard(lines: string[], startIdx: number): { card: BdfCard; linesConsumed: number } {
  let line = lines[startIdx];
  const fields: string[] = [];
  let linesConsumed = 1;

  // Card name is first 8 characters
  const name = line.substring(0, 8).trim().toUpperCase();

  // Fields 2-9 (indices 1-8) from first line
  for (let f = 1; f <= 8; f++) {
    const start = f * 8;
    const end = start + 8;
    fields.push(line.substring(start, Math.min(end, line.length)).trim());
  }

  // Field 10 is continuation marker (columns 73-80)
  // Check for continuation lines
  while (startIdx + linesConsumed < lines.length) {
    const nextLine = lines[startIdx + linesConsumed];
    if (!nextLine) break;

    // Continuation line starts with + or blank in field 1
    const firstField = nextLine.substring(0, 8).trim();
    if (firstField === '' || firstField.startsWith('+')) {
      // Read fields from continuation line
      for (let f = 1; f <= 8; f++) {
        const start = f * 8;
        const end = start + 8;
        fields.push(nextLine.substring(start, Math.min(end, nextLine.length)).trim());
      }
      linesConsumed++;
    } else {
      break;
    }
  }

  return { card: { name, fields }, linesConsumed };
}

/** Parse a large-field card (16-char fields) */
function parseLargeFieldCard(lines: string[], startIdx: number): { card: BdfCard; linesConsumed: number } {
  let line = lines[startIdx];
  const fields: string[] = [];
  let linesConsumed = 1;

  // Card name (remove trailing *)
  const name = line.substring(0, 8).trim().replace(/\*$/, '').toUpperCase();

  // Large field: field 1 = cols 9-24, field 2 = cols 25-40, field 3 = cols 41-56, field 4 = cols 57-72
  for (let f = 0; f < 4; f++) {
    const start = 8 + f * 16;
    const end = start + 16;
    fields.push(line.substring(start, Math.min(end, line.length)).trim());
  }

  // Continuation lines for large field start with *
  while (startIdx + linesConsumed < lines.length) {
    const nextLine = lines[startIdx + linesConsumed];
    if (!nextLine) break;

    const firstField = nextLine.substring(0, 8).trim();
    if (firstField.startsWith('*')) {
      for (let f = 0; f < 4; f++) {
        const start = 8 + f * 16;
        const end = start + 16;
        fields.push(nextLine.substring(start, Math.min(end, nextLine.length)).trim());
      }
      linesConsumed++;
    } else {
      break;
    }
  }

  return { card: { name, fields }, linesConsumed };
}

/** Parse a free-field (comma-separated) card */
function parseFreeFieldCard(lines: string[], startIdx: number): { card: BdfCard; linesConsumed: number } {
  let fullLine = lines[startIdx];
  let linesConsumed = 1;

  // Continuation: if line ends with comma or next line starts with comma/+
  while (fullLine.trim().endsWith(',') && startIdx + linesConsumed < lines.length) {
    const nextLine = lines[startIdx + linesConsumed];
    if (!nextLine) break;
    const trimmed = nextLine.trim();
    if (trimmed.startsWith('+') || trimmed.startsWith(',') || !trimmed.startsWith('$')) {
      fullLine += trimmed.startsWith('+') ? trimmed.substring(1) : trimmed;
      linesConsumed++;
    } else {
      break;
    }
  }

  const parts = fullLine.split(',').map((s) => s.trim());
  const name = parts[0].toUpperCase();
  const fields = parts.slice(1);

  return { card: { name, fields }, linesConsumed };
}

/** Parse a Nastran-format number (handles '1.0+3' shorthand for '1.0E+3') */
function parseNastranFloat(s: string): number {
  if (!s || s.trim() === '') return 0;
  let cleaned = s.trim();
  // Handle Nastran shorthand: "1.0+3" → "1.0E+3", "1.0-3" → "1.0E-3"
  // But not if it already has E/e
  if (!/[eEdD]/i.test(cleaned)) {
    // Match patterns like "1.234+5" or "1.234-5" (sign in middle after digits)
    cleaned = cleaned.replace(/(\d)([+-])(\d)/, '$1E$2$3');
  }
  cleaned = cleaned.replace(/[dD]/, 'E');
  return parseFloat(cleaned) || 0;
}

function parseNastranInt(s: string): number {
  if (!s || s.trim() === '') return 0;
  return parseInt(s.trim(), 10) || 0;
}

// ─── BDF Parser Implementation ──────────────────────────────────────────────

function parseBdf(content: string, filename?: string): MeshModel {
  const model = new MeshModel();
  model.metadata.sourceFormat = MeshFormat.BDF;
  model.metadata.sourceFilePath = filename;

  const lines = content.split(/\r?\n/);
  const propertyMap = new Map<number, { type: string; matId: number }>();

  let i = 0;

  while (i < lines.length) {
    const { card, linesConsumed } = parseCard(lines, i);
    i += linesConsumed;

    if (!card) continue;

    switch (card.name) {
      // ─── GRID ────────────────────────────────────────────────────────
      case 'GRID': {
        const id = parseNastranInt(card.fields[0]);
        const cp = parseNastranInt(card.fields[1]); // coordinate system (skip)
        const x = parseNastranFloat(card.fields[2]);
        const y = parseNastranFloat(card.fields[3]);
        const z = parseNastranFloat(card.fields[4]);

        if (id > 0) {
          model.nodes.addNode(id, x, y, z);
        }
        break;
      }

      // ─── Shell Elements ──────────────────────────────────────────────
      case 'CTRIA3': {
        const eid = parseNastranInt(card.fields[0]);
        const pid = parseNastranInt(card.fields[1]);
        const g1 = parseNastranInt(card.fields[2]);
        const g2 = parseNastranInt(card.fields[3]);
        const g3 = parseNastranInt(card.fields[4]);

        if (eid > 0) {
          model.elements.addElement({
            id: eid,
            shape: ElementShape.TRI3,
            nodeIds: [g1, g2, g3],
            componentName: '',
            attrs: { ...defaultElementAttributes(), propertyId: pid },
          });
        }
        break;
      }

      case 'CTRIA6': {
        const eid = parseNastranInt(card.fields[0]);
        const pid = parseNastranInt(card.fields[1]);
        const nodeIds = card.fields.slice(2, 8).map(parseNastranInt).filter((n) => n > 0);
        if (eid > 0) {
          model.elements.addElement({
            id: eid,
            shape: ElementShape.TRI6,
            nodeIds,
            componentName: '',
            attrs: { ...defaultElementAttributes(), propertyId: pid },
          });
        }
        break;
      }

      case 'CQUAD4': {
        const eid = parseNastranInt(card.fields[0]);
        const pid = parseNastranInt(card.fields[1]);
        const g1 = parseNastranInt(card.fields[2]);
        const g2 = parseNastranInt(card.fields[3]);
        const g3 = parseNastranInt(card.fields[4]);
        const g4 = parseNastranInt(card.fields[5]);

        if (eid > 0) {
          model.elements.addElement({
            id: eid,
            shape: ElementShape.QUAD4,
            nodeIds: [g1, g2, g3, g4],
            componentName: '',
            attrs: { ...defaultElementAttributes(), propertyId: pid },
          });
        }
        break;
      }

      case 'CQUAD8': {
        const eid = parseNastranInt(card.fields[0]);
        const pid = parseNastranInt(card.fields[1]);
        const nodeIds = card.fields.slice(2, 10).map(parseNastranInt).filter((n) => n > 0);
        if (eid > 0) {
          model.elements.addElement({
            id: eid,
            shape: ElementShape.QUAD8,
            nodeIds,
            componentName: '',
            attrs: { ...defaultElementAttributes(), propertyId: pid },
          });
        }
        break;
      }

      // ─── Solid Elements ──────────────────────────────────────────────
      case 'CTETRA': {
        const eid = parseNastranInt(card.fields[0]);
        const pid = parseNastranInt(card.fields[1]);
        const nodeIds = card.fields.slice(2).map(parseNastranInt).filter((n) => n > 0);
        const shape = nodeIds.length >= 10 ? ElementShape.TET10 : ElementShape.TET4;
        if (eid > 0) {
          model.elements.addElement({
            id: eid, shape, nodeIds,
            componentName: '',
            attrs: { ...defaultElementAttributes(), propertyId: pid },
          });
        }
        break;
      }

      case 'CHEXA': {
        const eid = parseNastranInt(card.fields[0]);
        const pid = parseNastranInt(card.fields[1]);
        const nodeIds = card.fields.slice(2).map(parseNastranInt).filter((n) => n > 0);
        const shape = nodeIds.length >= 20 ? ElementShape.HEX20 : ElementShape.HEX8;
        if (eid > 0) {
          model.elements.addElement({
            id: eid, shape, nodeIds,
            componentName: '',
            attrs: { ...defaultElementAttributes(), propertyId: pid },
          });
        }
        break;
      }

      case 'CPENTA': {
        const eid = parseNastranInt(card.fields[0]);
        const pid = parseNastranInt(card.fields[1]);
        const nodeIds = card.fields.slice(2).map(parseNastranInt).filter((n) => n > 0);
        const shape = nodeIds.length >= 15 ? ElementShape.WEDGE15 : ElementShape.WEDGE6;
        if (eid > 0) {
          model.elements.addElement({
            id: eid, shape, nodeIds,
            componentName: '',
            attrs: { ...defaultElementAttributes(), propertyId: pid },
          });
        }
        break;
      }

      // ─── Beam Elements ───────────────────────────────────────────────
      case 'CBAR':
      case 'CBEAM': {
        const eid = parseNastranInt(card.fields[0]);
        const pid = parseNastranInt(card.fields[1]);
        const g1 = parseNastranInt(card.fields[2]);
        const g2 = parseNastranInt(card.fields[3]);
        if (eid > 0) {
          model.elements.addElement({
            id: eid,
            shape: ElementShape.BEAM2,
            nodeIds: [g1, g2],
            componentName: '',
            attrs: { ...defaultElementAttributes(), propertyId: pid },
          });
        }
        break;
      }

      // ─── Property Cards ──────────────────────────────────────────────
      case 'PSHELL': {
        const pid = parseNastranInt(card.fields[0]);
        const mid = parseNastranInt(card.fields[1]);
        propertyMap.set(pid, { type: 'PSHELL', matId: mid });
        break;
      }

      case 'PSOLID': {
        const pid = parseNastranInt(card.fields[0]);
        const mid = parseNastranInt(card.fields[1]);
        propertyMap.set(pid, { type: 'PSOLID', matId: mid });
        break;
      }

      case 'PBAR':
      case 'PBEAM': {
        const pid = parseNastranInt(card.fields[0]);
        const mid = parseNastranInt(card.fields[1]);
        propertyMap.set(pid, { type: card.name, matId: mid });
        break;
      }
    }
  }

  // Apply property → material mapping to elements
  for (const elem of model.elements) {
    const prop = propertyMap.get(elem.attrs.propertyId);
    if (prop) {
      elem.attrs.materialId = prop.matId;
    }
  }

  // Store property map for round-trip
  model.metadata.formatExtras['propertyMap'] = Object.fromEntries(
    Array.from(propertyMap.entries()).map(([k, v]) => [k.toString(), v])
  );

  return model;
}

// ─── Register Parser ─────────────────────────────────────────────────────────

export const bdfParser: MeshParser = {
  formatName: 'Nastran BDF',
  extensions: ['.bdf', '.nas', '.dat'],
  parse: parseBdf,
};

registerParser(bdfParser);

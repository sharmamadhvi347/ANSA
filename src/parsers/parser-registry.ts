/**
 * parser-registry.ts — Plugin-style parser/writer registry
 *
 * Auto-detects format by file extension. New formats are added by
 * registering a parser/writer — no core code changes needed.
 */

import { MeshModel } from '../core/mesh-model';

// ─── Parser Interface ────────────────────────────────────────────────────────

export interface MeshParser {
  /** Format name for display */
  formatName: string;
  /** File extensions this parser handles (lowercase, with dot) */
  extensions: string[];
  /** Parse file content into a MeshModel */
  parse(content: string, filename?: string): MeshModel;
}

export interface WriteOptions {
  /** Precision for coordinate output (decimal places) */
  precision?: number;
  /** Include comments/header in output */
  includeHeader?: boolean;
  /** Title to include in file header */
  title?: string;
}

export interface MeshWriter {
  /** Format name for display */
  formatName: string;
  /** Default file extension (with dot) */
  defaultExtension: string;
  /** Write a MeshModel to file content string */
  write(model: MeshModel, options?: WriteOptions): string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const parsers: MeshParser[] = [];
const writers: MeshWriter[] = [];

export function registerParser(parser: MeshParser): void {
  parsers.push(parser);
}

export function registerWriter(writer: MeshWriter): void {
  writers.push(writer);
}

export function getParserForFile(filename: string): MeshParser | null {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  for (const parser of parsers) {
    if (parser.extensions.includes(ext)) {
      return parser;
    }
  }
  return null;
}

export function getWriterForFormat(formatName: string): MeshWriter | null {
  for (const writer of writers) {
    if (writer.formatName.toLowerCase() === formatName.toLowerCase()) {
      return writer;
    }
  }
  return null;
}

export function getWriterForExtension(ext: string): MeshWriter | null {
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : '.' + ext.toLowerCase();
  for (const writer of writers) {
    if (writer.defaultExtension === normalizedExt) {
      return writer;
    }
  }
  return null;
}

export function getAllParsers(): MeshParser[] {
  return [...parsers];
}

export function getAllWriters(): MeshWriter[] {
  return [...writers];
}

/** Get all supported import extensions */
export function getSupportedImportExtensions(): string[] {
  const exts = new Set<string>();
  for (const parser of parsers) {
    for (const ext of parser.extensions) {
      exts.add(ext);
    }
  }
  return Array.from(exts);
}

/** Detect if a filename is a mesh file we can parse */
export function isMeshFile(filename: string): boolean {
  return getParserForFile(filename) !== null;
}

/** Detect if a filename is a CAD file (for future Phase 2) */
export function isCadFile(filename: string): boolean {
  const cadExtensions = ['.stp', '.step', '.igs', '.iges', '.x_t', '.x_b'];
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return cadExtensions.includes(ext);
}

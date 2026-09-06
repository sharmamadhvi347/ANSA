/**
 * main.ts — MeshMend AI renderer entry point
 *
 * Wires together the parser registry, diagnostic engine, 3D viewport,
 * and UI panels into a working IDE experience.
 */

import './styles/index.css';

// Import parsers (self-registering on import)
import './parsers/cdb-parser';
import './parsers/cdb-writer';
import './parsers/inp-parser';
import './parsers/inp-writer';
import './parsers/bdf-parser';
import './parsers/bdf-writer';

import { MeshModel, MeshFormat } from './core/mesh-model';
import { getParserForFile, getWriterForExtension, isMeshFile, isCadFile } from './parsers/parser-registry';
import { DiagnosticEngine } from './diagnostics/diagnostic-engine';
import { DefectRecord, QualityThresholds, DEFAULT_THRESHOLDS, DiagnosticSummary } from './diagnostics/defect-record';
import { Viewport } from './viewer/viewport';
import { generateMeshBuffers, generateDefectHighlights, applyDeviationHeatmap, MeshBuffers } from './viewer/mesh-renderer';
// @ts-ignore
import simpleQuadRaw from '../test/fixtures/simple_quad.inp?raw';

// ─── Type Declarations for Preload API ──────────────────────────────────────

declare global {
  interface Window {
    meshmend: {
      openProject(): Promise<string | null>;
      readDir(path: string): Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
      readFile(path: string): Promise<string | null>;
      writeFile(path: string, content: string): Promise<boolean>;
      stat(path: string): Promise<{ size: number; isDirectory: boolean; modified: string } | null>;
    };
  }
}

// ─── Application State ──────────────────────────────────────────────────────

interface AppState {
  projectPath: string | null;
  currentModel: MeshModel | null;
  currentFile: string | null;
  meshBuffers: MeshBuffers | null;
  defects: DefectRecord[];
  summary: DiagnosticSummary | null;
  viewport: Viewport | null;
  thresholds: QualityThresholds;
  wireframeVisible: boolean;
}

const state: AppState = {
  projectPath: null,
  currentModel: null,
  currentFile: null,
  meshBuffers: null,
  defects: [],
  summary: null,
  viewport: null,
  thresholds: { ...DEFAULT_THRESHOLDS },
  wireframeVisible: true,
};

// ─── DOM Elements ───────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;

const btnOpenProject = $('btn-open-project') as HTMLButtonElement;
const btnImportAnsa = $('btn-import-ansa') as HTMLButtonElement;
const fileUploadAnsa = $('file-upload-ansa') as HTMLInputElement;
const btnOpenProjectAlt = $('btn-open-project-alt') as HTMLButtonElement;
const btnRunDiagnostics = $('btn-run-diagnostics') as HTMLButtonElement;
const btnExport = $('btn-export') as HTMLButtonElement;
const btnToggleWireframe = $('btn-toggle-wireframe') as HTMLButtonElement;
const btnFitView = $('btn-fit-view') as HTMLButtonElement;

// ─── Initialization ─────────────────────────────────────────────────────────

function init(): void {
  // Tab switching
  const tabDiagnostics = $('panel').querySelector('[data-tab="diagnostics"]') as HTMLElement;
  const tabSettings = $('panel').querySelector('[data-tab="settings"]') as HTMLElement;
  const tabAgent = $('panel').querySelector('[data-tab="agent"]') as HTMLElement;

  const contentQuality = $('quality-card');
  const contentList = $('defect-list');
  const contentSettings = $('settings-content');
  const contentAgent = $('agent-content');
  const emptyDiag = $('diag-empty');

  const tabs = [
    { tab: tabDiagnostics, views: [contentQuality, contentList] },
    { tab: tabSettings, views: [contentSettings] },
    { tab: tabAgent, views: [contentAgent] }
  ];

  tabs.forEach(({ tab, views }) => {
    tab.addEventListener('click', () => {
      // Clear active states
      tabs.forEach((t) => {
        t.tab.classList.remove('active');
        t.views.forEach(v => { if (v) v.style.display = 'none'; });
      });
      // Set active
      tab.classList.add('active');
      views.forEach(v => { if (v) v.style.display = 'block'; });

      // Special case for diagnostics empty state
      if (tab === tabDiagnostics && state.defects.length === 0 && !state.currentModel) {
        contentQuality.style.display = 'none';
        contentList.style.display = 'none';
        emptyDiag.style.display = 'flex';
      } else {
        emptyDiag.style.display = 'none';
      }
    });
  });

  // Button handlers
  const btnRunAgent = $('btn-run-agent') as HTMLButtonElement;
  
  btnOpenProject.addEventListener('click', openProject);
  btnOpenProjectAlt.addEventListener('click', openProject);
  btnRunDiagnostics.addEventListener('click', runDiagnostics);
  btnExport.addEventListener('click', exportMesh);
  btnToggleWireframe.addEventListener('click', toggleWireframe);
  btnFitView.addEventListener('click', () => state.viewport?.fitToView());
  btnRunAgent.addEventListener('click', runAgentFlow);

  // Ansa file upload logic for browser mode
  if (btnImportAnsa && fileUploadAnsa) {
    btnImportAnsa.addEventListener('click', () => {
      fileUploadAnsa.click();
    });
    
    fileUploadAnsa.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      setStatus(`Importing proprietary file ${file.name}...`, true);
      
      // Send the path to the Python Sidecar
      setTimeout(async () => {
        try {
          const absolutePath = (file as any).path || file.name;
          setStatus(`Sending ${file.name} to sidecar for processing...`);
          
          const createJobRes = await fetch('http://127.0.0.1:5000/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filepath: absolutePath })
          });
          
          if (!createJobRes.ok) {
              const errData = await createJobRes.json();
              throw new Error(errData.error || 'Failed to create job');
          }
          
          const job = await createJobRes.json();
          const jobId = job.job_id;
          
          setStatus(`Job created: ${jobId}. Running inspection and planning...`);
          
          const runJobRes = await fetch(`http://127.0.0.1:5000/api/jobs/${jobId}/run`, {
            method: 'POST'
          });
          
          const finalJob = await runJobRes.json();
          
          // Render Planned Operations to Console / UI conceptually
          console.log("== REPAIR PLANS ==");
          Object.values(finalJob.repair_plans || {}).forEach((plan: any) => {
              console.log(`[PLANNED Strategy] ${plan.source_case} -> ${plan.reasoning}`);
              if (plan.ordered_operations) {
                  plan.ordered_operations.forEach((op: any, i: number) => {
                      console.log(`  Step ${i+1}: ${op.operation_name} - ${op.expected_outcome}`);
                  });
              }
          });
          
          if (finalJob.status === 'FAILED') {
              setStatus(`⚠️ ANSA runtime unavailable - operations were PLANNED but NOT EXECUTED.`, false, true);
              alert(`Pipeline stopped:\n\n${finalJob.error_message}\n\nRepair plans were generated but execution was safely aborted.`);
          } else {
              setStatus(`Job completed and EXECUTED successfully!`);
          }
          
          console.log("Full Job Output:", finalJob);

          $('status-format').style.display = 'flex';
          $('status-format-name').textContent = 'ANSA (via Sidecar)';
          
        } catch (err: any) {
          setStatus(`Failed to process ${file.name}: ${err.message}`, false, true);
          console.error(err);
        }
      }, 500);
    });
  }

  setStatus('Ready — Open a project to begin');
}

import { AgentLoop } from './agent/agent-loop';
import { CadKernel } from './core/cad-kernel';

let globalCadKernel = new CadKernel();
let globalAgent: AgentLoop | null = null;

async function runAgentFlow(): Promise<void> {
  if (!state.currentModel) return;

  if (!globalAgent) {
    globalAgent = new AgentLoop(globalCadKernel);
    const logContainer = $('agent-logs');
    globalAgent.onLog = (log) => {
      const entry = document.createElement('div');
      entry.style.display = 'flex';
      entry.style.gap = '8px';
      
      const time = log.timestamp.toLocaleTimeString([], { hour12: false });
      const color = log.success ? 'var(--severity-1)' : (log.action === 'ABORT' ? 'var(--severity-5)' : 'var(--text-secondary)');
      
      entry.innerHTML = `
        <span style="color: var(--text-tertiary);">[${time}]</span>
        <span style="color: ${color}; font-weight: bold;">${log.defectId !== 'SYSTEM' ? '[' + log.defectId + ']' : '[SYS]'}</span>
        <span>${log.message}</span>
      `;
      logContainer.appendChild(entry);
      logContainer.parentElement!.scrollTop = logContainer.parentElement!.scrollHeight;
    };
  }

  const logContainer = $('agent-logs');
  logContainer.innerHTML = ''; // Clear previous logs
  
  const btnRunAgent = $('btn-run-agent') as HTMLButtonElement;
  btnRunAgent.disabled = true;
  btnRunAgent.textContent = 'Agent Running...';
  
  try {
    setStatus('Agent is repairing mesh...', true);
    await globalAgent.runAutoFix(state.currentModel);
    
    // Re-run diagnostics to update UI and Viewport
    runDiagnostics();
    setStatus('Agent repair complete.');
  } catch (err) {
    console.error(err);
    setStatus('Agent failed due to error.', false, true);
  } finally {
    btnRunAgent.disabled = false;
    btnRunAgent.textContent = 'Run Auto-Fix';
  }
}

// ─── Project Management ─────────────────────────────────────────────────────

async function openProject(): Promise<void> {
  if (!window.meshmend) {
    // Running in browser without Electron — use demo mode
    setStatus('Running in browser mode (no Electron)');
    return;
  }

  const path = await window.meshmend.openProject();
  if (!path) return;

  state.projectPath = path;
  setStatus(`Opened project: ${path.split('/').pop()}`);
  await loadFileTree(path);
}

async function loadFileTree(dirPath: string, parentEl?: HTMLElement): Promise<void> {
  const fileTree = parentEl || $('file-tree');
  if (!parentEl) {
    fileTree.innerHTML = '';
    $('sidebar-empty')?.remove();
  }

  const entries = await window.meshmend.readDir(dirPath);
  let fileCount = 0;

  // Sort: directories first, then files
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    // Skip hidden files
    if (entry.name.startsWith('.')) continue;

    const item = document.createElement('div');
    item.className = 'tree-item fade-in';
    item.style.animationDelay = `${fileCount * 20}ms`;

    if (entry.isDirectory) {
      item.innerHTML = `<span class="file-icon dir">📁</span><span>${entry.name}</span>`;
      item.addEventListener('click', () => {
        // Toggle directory expansion (simplified)
        item.classList.toggle('active');
      });
    } else {
      const isMesh = isMeshFile(entry.name);
      const isCad = isCadFile(entry.name);
      const iconClass = isMesh ? 'mesh' : isCad ? 'cad' : 'log';
      const icon = isMesh ? '🔷' : isCad ? '🔶' : '📄';

      item.innerHTML = `<span class="file-icon ${iconClass}">${icon}</span><span>${entry.name}</span>`;

      if (isMesh) {
        item.addEventListener('click', () => loadMeshFile(entry.path, entry.name));
      } else if (isCad) {
        item.addEventListener('click', () => loadCadFile(entry.path, entry.name));
      }

      fileCount++;
    }

    fileTree.appendChild(item);
  }

  $('file-count').textContent = fileCount.toString();
}

async function loadCadFile(filePath: string, fileName: string): Promise<void> {
  setStatus(`Loading CAD file ${fileName}...`, true);
  try {
    // We need to read the file as Uint8Array for opencascade
    // window.meshmend.readFile reads as string (utf8). 
    // Wait, we need a way to read as binary if it's a binary STEP, but STEP is usually text.
    // If we use string we can convert to Uint8Array.
    const contentStr = await window.meshmend.readFile(filePath);
    if (!contentStr) {
      setStatus(`Failed to read CAD file ${fileName}`, false, true);
      return;
    }
    const encoder = new TextEncoder();
    const content = encoder.encode(contentStr);

    await globalCadKernel.init();
    await globalCadKernel.loadSTEP(filePath, content);
    
    setStatus(`Loaded CAD file ${fileName}. Ready for Auto-Fix!`);
    
    // Highlight active file in tree
    document.querySelectorAll('.tree-item').forEach((item) => {
      if (item.textContent?.includes(fileName)) {
        item.classList.add('active');
      }
    });
  } catch (err) {
    setStatus(`Failed to load CAD: ${err instanceof Error ? err.message : 'Unknown error'}`, false, true);
    console.error('CAD Load Error:', err);
  }
}

// ─── Mesh Loading ───────────────────────────────────────────────────────────

async function loadMeshFile(filePath: string, fileName: string): Promise<void> {
  setStatus(`Loading ${fileName}...`, true);

  const content = await window.meshmend.readFile(filePath);
  if (!content) {
    setStatus(`Failed to read ${fileName}`, false, true);
    return;
  }

  const parser = getParserForFile(fileName);
  if (!parser) {
    setStatus(`No parser for ${fileName}`, false, true);
    return;
  }

  try {
    const startTime = performance.now();
    const model = parser.parse(content, fileName);
    const parseTime = (performance.now() - startTime).toFixed(0);

    state.currentModel = model;
    state.currentFile = filePath;

    // Update UI
    btnRunDiagnostics.disabled = false;
    btnExport.disabled = false;
    const btnRunAgent = $('btn-run-agent') as HTMLButtonElement;
    if (btnRunAgent) btnRunAgent.disabled = false;

    // Initialize viewport if needed
    if (!state.viewport) {
      const viewportEl = $('viewport');
      const emptyState = $('viewport-empty');
      emptyState.style.display = 'none';
      state.viewport = new Viewport(viewportEl);
    } else {
      $('viewport-empty').style.display = 'none';
    }

    // Generate buffers and render
    state.meshBuffers = generateMeshBuffers(model);
    state.viewport.loadMesh(
      state.meshBuffers.positions,
      state.meshBuffers.triangleIndices,
      state.meshBuffers.wireframeIndices,
    );

    // Update viewport overlay
    $('viewport-overlay').style.display = 'flex';
    $('chip-elements').textContent = `${model.elements.count.toLocaleString()} elements`;
    $('chip-nodes').textContent = `${model.nodes.count.toLocaleString()} nodes`;

    // Update status
    const formatName = model.metadata.sourceFormat.toUpperCase();
    $('status-format').style.display = 'flex';
    $('status-format-name').textContent = formatName;

    setStatus(`Loaded ${fileName} — ${model.elements.count.toLocaleString()} elements, ${model.nodes.count.toLocaleString()} nodes (${parseTime}ms)`);

    // Highlight active file in tree
    document.querySelectorAll('.tree-item').forEach((item) => item.classList.remove('active'));

    // Auto-run diagnostics
    runDiagnostics();
  } catch (err) {
    setStatus(`Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`, false, true);
    console.error('Parse error:', err);
  }
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

function runDiagnostics(): void {
  if (!state.currentModel) return;

  setStatus('Running diagnostics...', true);
  const startTime = performance.now();

  // Read thresholds from settings UI
  readThresholdsFromUI();

  const engine = new DiagnosticEngine(state.currentModel, state.thresholds);
  state.defects = engine.runFullDiagnostics();
  state.summary = engine.generateSummary(state.defects);

  const diagTime = (performance.now() - startTime).toFixed(0);

  // Update quality card
  updateQualityCard(state.summary);

  // Update defect list
  updateDefectList(state.defects);

  // Update defect highlights in viewport
  if (state.viewport && state.meshBuffers && state.currentModel) {
    const highlights = generateDefectHighlights(state.currentModel, state.defects, state.meshBuffers);
    state.viewport.setDefectHighlights(highlights);

    // Apply deviation heatmap to vertex colors
    applyDeviationHeatmap(state.meshBuffers, state.defects);
    
    // Reload mesh to update vertex colors
    state.viewport.loadMesh(
      state.meshBuffers.positions,
      state.meshBuffers.triangleIndices,
      state.meshBuffers.wireframeIndices,
      state.meshBuffers.colors
    );
  }

  // Update badge
  const diagCount = $('diag-count');
  if (state.defects.length > 0) {
    diagCount.style.display = 'inline-flex';
    diagCount.textContent = state.defects.length.toString();
  } else {
    diagCount.style.display = 'none';
  }

  $('diag-empty').style.display = 'none';

  setStatus(`Diagnostics complete: ${state.defects.length} defects found (${diagTime}ms)`);
}

function updateQualityCard(summary: DiagnosticSummary): void {
  const card = $('quality-card');
  card.style.display = 'block';

  const score = summary.overallQualityScore;
  $('quality-score-value').textContent = score.toString();
  $('quality-score-value').style.color = score >= 80 ? 'var(--severity-1)' :
    score >= 60 ? 'var(--severity-2)' :
    score >= 40 ? 'var(--severity-3)' : 'var(--severity-4)';

  const barFill = $('quality-bar-fill') as HTMLElement;
  barFill.style.width = `${score}%`;
  barFill.style.background = score >= 80
    ? 'linear-gradient(90deg, var(--severity-1), #16a34a)'
    : score >= 60
    ? 'linear-gradient(90deg, var(--severity-2), var(--severity-3))'
    : 'linear-gradient(90deg, var(--severity-4), var(--severity-5))';

  $('stat-elements').textContent = summary.totalElements.toLocaleString();
  $('stat-nodes').textContent = summary.totalNodes.toLocaleString();
  $('stat-defects').textContent = summary.totalDefects.toLocaleString();
  $('stat-critical').textContent = ((summary.defectsBySeverity[4] || 0) + (summary.defectsBySeverity[5] || 0)).toString();
}

function updateDefectList(defects: DefectRecord[]): void {
  const list = $('defect-list');
  list.innerHTML = '';

  for (const defect of defects) {
    const item = document.createElement('div');
    item.className = 'defect-item fade-in';

    const typeLabel = defect.type.replace(/_/g, ' ');

    item.innerHTML = `
      <div class="defect-severity s${defect.severity}"></div>
      <div class="defect-content">
        <div class="defect-type">${typeLabel}</div>
        <div class="defect-description">${defect.description}</div>
      </div>
      <div class="defect-metric">${formatMetricValue(defect)}</div>
    `;

    // Click to navigate
    item.addEventListener('click', () => {
      if (state.viewport) {
        state.viewport.flyTo(defect.location.x, defect.location.y, defect.location.z);
      }
    });

    list.appendChild(item);
  }
}

function formatMetricValue(defect: DefectRecord): string {
  if (defect.metricValue === Infinity) return '∞';
  if (defect.type.includes('ANGLE') || defect.type === 'WARPAGE') {
    return `${defect.metricValue.toFixed(1)}°`;
  }
  if (defect.type === 'DUPLICATE_NODES' || defect.type === 'UNREFERENCED_NODES') {
    return `×${Math.round(defect.metricValue)}`;
  }
  return defect.metricValue.toFixed(3);
}

// ─── Export ──────────────────────────────────────────────────────────────────

async function exportMesh(): Promise<void> {
  if (!state.currentModel || !state.currentFile) return;

  const ext = '.' + state.currentFile.split('.').pop()?.toLowerCase();
  const writer = getWriterForExtension(ext);
  if (!writer) {
    setStatus(`No writer for format ${ext}`);
    return;
  }

  setStatus('Exporting mesh...');
  const content = writer.write(state.currentModel, {
    includeHeader: true,
    title: `Corrected by MeshMend AI — ${new Date().toISOString()}`,
  });

  // Write to file with _corrected suffix
  const baseName = state.currentFile.replace(/\.[^.]+$/, '');
  const outputPath = `${baseName}_corrected${ext}`;

  const success = await window.meshmend.writeFile(outputPath, content);
  if (success) {
    setStatus(`Exported to ${outputPath.split('/').pop()}`);
  } else {
    setStatus('Export failed', false, true);
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

function readThresholdsFromUI(): void {
  state.thresholds.maxAspectRatio = parseFloat(($('set-aspect-ratio') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.maxAspectRatio;
  state.thresholds.minJacobian = parseFloat(($('set-jacobian') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.minJacobian;
  state.thresholds.maxWarpage = parseFloat(($('set-warpage') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.maxWarpage;
  state.thresholds.maxSkewness = parseFloat(($('set-skewness') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.maxSkewness;
  state.thresholds.minAngleTri = parseFloat(($('set-min-angle-tri') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.minAngleTri;
  state.thresholds.maxAngleTri = parseFloat(($('set-max-angle-tri') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.maxAngleTri;
  state.thresholds.minAngleQuad = parseFloat(($('set-min-angle-quad') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.minAngleQuad;
  state.thresholds.maxAngleQuad = parseFloat(($('set-max-angle-quad') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.maxAngleQuad;
  state.thresholds.duplicateNodeTolerance = parseFloat(($('set-dup-tol') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.duplicateNodeTolerance;
  state.thresholds.minElementQuality = parseFloat(($('set-min-quality') as HTMLInputElement).value) || DEFAULT_THRESHOLDS.minElementQuality;
}

// ─── Viewport Controls ──────────────────────────────────────────────────────

function toggleWireframe(): void {
  state.wireframeVisible = !state.wireframeVisible;
  state.viewport?.toggleWireframe(state.wireframeVisible);
  btnToggleWireframe.style.color = state.wireframeVisible ? 'var(--accent-blue)' : 'var(--text-secondary)';
}

// ─── Status Bar ─────────────────────────────────────────────────────────────

function setStatus(text: string, loading: boolean = false, error: boolean = false): void {
  const statusText = $('status-text');
  const statusDot = $('status-dot');

  statusText.textContent = text;
  statusDot.className = 'status-dot' + (error ? ' error' : '');

  if (loading) {
    statusText.classList.add('loading-pulse');
  } else {
    statusText.classList.remove('loading-pulse');
  }
}

// ─── Boot ───────────────────────────────────────────────────────────────────

init();

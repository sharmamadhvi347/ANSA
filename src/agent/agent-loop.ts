import { MeshModel } from '../core/mesh-model';
import { DiagnosticEngine } from '../diagnostics/diagnostic-engine';
import { DefectRecord, DefectType, FixStrategy } from '../diagnostics/defect-record';
import { CadKernel } from '../core/cad-kernel';
import * as meshTools from '../core/mesh-tools';

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: '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',
  dangerouslyAllowBrowser: true,
});

export interface AgentActionLog {
  timestamp: Date;
  defectId: string;
  action: string;
  message: string;
  success: boolean;
}

/**
 * The Autonomous AI Agent loop that uses GPT-4 to fix the mesh.
 */
export class AgentLoop {
  private cadKernel: CadKernel;
  private logs: AgentActionLog[] = [];

  // Callback to update UI during processing
  public onLog?: (log: AgentActionLog) => void;

  constructor(cadKernel: CadKernel) {
    this.cadKernel = cadKernel;
  }

  /**
   * Run the AI loop on the model.
   * Modifies the model in place.
   */
  public async runAutoFix(model: MeshModel, maxIterations: number = 3): Promise<void> {
    this.logs = [];

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      this.addLog('SYSTEM', 'SYSTEM_START', `Starting Agent Iteration ${iteration}...`, true);
      
      // 1. Run Diagnostics
      const diagnosticEngine = new DiagnosticEngine(model, undefined, this.cadKernel);
      const defects = diagnosticEngine.runFullDiagnostics();
      
      if (defects.length === 0) {
        this.addLog('SYSTEM', 'SUCCESS', `Mesh is clean! No defects found in iteration ${iteration}.`, true);
        break; // We are done!
      }

      this.addLog('SYSTEM', 'ANALYSIS', `Found ${defects.length} defects. Querying GPT-4 for repair strategy.`, true);

      // 2. Query OpenAI for fixes
      const defectSummary = defects.map(d => ({
        id: d.id,
        type: d.type,
        elements: d.elementIds,
        value: d.metricValue
      }));

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an autonomous AI agent for finite element mesh repair. You are given a list of mesh defects. For each defect, choose exactly one repair strategy from the following allowed strings: "PROJECT_TO_CAD", "LAPLACIAN_SMOOTH", or "DELETE_ELEMENT". Respond strictly with a JSON object containing a "fixes" array of objects, e.g. {"fixes": [{"defectId": "D_...", "action": "LAPLACIAN_SMOOTH"}]}.'
            },
            {
              role: 'user',
              content: JSON.stringify(defectSummary)
            }
          ],
          response_format: { type: 'json_object' }
        });

        const rawResponse = response.choices[0]?.message?.content;
        if (!rawResponse) throw new Error('No response from GPT-4');

        const parsed = JSON.parse(rawResponse);
        const fixes = parsed.fixes || [];
        
        let fixesApplied = 0;

        for (const fix of fixes) {
          const defect = defects.find(d => d.id === fix.defectId);
          if (!defect) continue;

          const nodesInvolved = this.getNodesForDefect(model, defect);
          if (nodesInvolved.length === 0) continue;

          let success = false;
          let message = '';

          switch (fix.action) {
            case 'PROJECT_TO_CAD':
              for (const nid of nodesInvolved) {
                try {
                  if (meshTools.projectNodeToCad(model, nid, this.cadKernel)) {
                    success = true;
                  }
                } catch (err) {
                  message = 'Error during projection (CAD kernel not ready?). Falling back to smoothing.';
                  meshTools.laplacianSmooth(model, nid);
                  success = true;
                }
              }
              if (message === '') message = `GPT-4 projected element ${defect.elementIds[0]}'s nodes to nearest CAD surface.`;
              break;
              
            case 'LAPLACIAN_SMOOTH':
              for (const nid of nodesInvolved) {
                if (meshTools.laplacianSmooth(model, nid)) {
                  success = true;
                }
              }
              message = `GPT-4 applied laplacian smoothing to nodes in element ${defect.elementIds[0]}.`;
              break;
              
            case 'DELETE_ELEMENT':
              model.elements.removeElement(defect.elementIds[0]);
              success = true;
              message = `GPT-4 deleted element ${defect.elementIds[0]} as requested.`;
              break;

            default:
              message = `GPT-4 suggested unknown action: ${fix.action}. Ignored.`;
              break;
          }

          this.addLog(defect.id, fix.action, message, success);
          if (success) {
            fixesApplied++;
          }
        }

        // Cleanup dangling nodes
        const removed = meshTools.removeUnreferencedNodes(model);
        if (removed > 0) {
          this.addLog('SYSTEM', 'removeUnreferencedNodes', `Cleaned up ${removed} unreferenced nodes.`, true);
        }

        this.addLog('SYSTEM', 'ITERATION_COMPLETE', `Iteration ${iteration} complete. Applied ${fixesApplied} fixes.`, true);

        if (fixesApplied === 0) {
          this.addLog('SYSTEM', 'ABORT', `GPT-4 could not find any successful fixes in iteration ${iteration}. Aborting.`, false);
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        this.addLog('SYSTEM', 'ERROR', `Failed to query GPT-4: ${err instanceof Error ? err.message : String(err)}`, false);
        break;
      }
    }
  }

  private getNodesForDefect(model: MeshModel, defect: DefectRecord): number[] {
    if (!defect.elementIds || defect.elementIds.length === 0) return [];
    const elem = model.elements.getElement(defect.elementIds[0]);
    if (!elem) return [];
    // Only return distinct defined node IDs
    return Array.from(new Set(elem.nodeIds.filter(id => id !== undefined)));
  }

  private addLog(defectId: string, action: string, message: string, success: boolean) {
    const log: AgentActionLog = {
      timestamp: new Date(),
      defectId,
      action,
      message,
      success
    };
    this.logs.push(log);
    if (this.onLog) {
      this.onLog(log);
    }
  }
}

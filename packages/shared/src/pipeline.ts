/** Steps of the analysis pipeline, in order. The client's progress stepper renders these labels. */
export const PIPELINE_STEPS = [
  { key: 'queued', label: 'Waiting in queue', progress: 0 },
  { key: 'meta', label: 'Fetching repository metadata', progress: 10 },
  { key: 'download', label: 'Downloading source code', progress: 30 },
  { key: 'stack', label: 'Detecting the stack', progress: 45 },
  { key: 'env', label: 'Scanning environment variables', progress: 55 },
  { key: 'checklist', label: 'Running the health checklist', progress: 60 },
  { key: 'deep', label: 'Mapping architecture, dependencies and people', progress: 75 },
  { key: 'score', label: 'Calculating the readiness score', progress: 95 },
  { key: 'done', label: 'Done', progress: 100 },
] as const;

export type PipelineStepKey = (typeof PIPELINE_STEPS)[number]['key'];

export function pipelineStep(key: PipelineStepKey): { step: string; progress: number } {
  const found = PIPELINE_STEPS.find((s) => s.key === key)!;
  return { step: found.label, progress: found.progress };
}

import type { AnalysisStatus, ErrorCode, Report } from '@repoready/shared';
import mongoose, { Schema } from 'mongoose';

/**
 * PUBLIC analyses only. Private-mode analyses (Addendum 01) live in the in-memory store and must
 * never be written here.
 */
export interface AnalysisDoc {
  owner: string;
  repo: string;
  fullName: string;
  commitSha: string;
  status: AnalysisStatus;
  step: string;
  progress: number;
  error: { code: ErrorCode; message: string } | null;
  report: Report | null;
  scoreTotal: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  expiresAt: Date;
  engineVersion: number; // see pipeline/engineVersion.ts
}

export const PUBLIC_RETENTION_DAYS = 30;

const analysisSchema = new Schema<AnalysisDoc>(
  {
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    fullName: { type: String, required: true },
    commitSha: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed'],
      required: true,
      default: 'queued',
    },
    step: { type: String, default: '' },
    progress: { type: Number, default: 0 },
    error: { type: Schema.Types.Mixed, default: null },
    report: { type: Schema.Types.Mixed, default: null },
    scoreTotal: { type: Number, default: null },
    createdAt: { type: Date, default: () => new Date() },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    engineVersion: { type: Number, default: 0 },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + PUBLIC_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    },
  },
  { versionKey: false, minimize: false },
);

analysisSchema.index({ fullName: 1, commitSha: 1, createdAt: -1 });
analysisSchema.index({ status: 1, createdAt: -1 });
analysisSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AnalysisModel = mongoose.model<AnalysisDoc>('Analysis', analysisSchema);

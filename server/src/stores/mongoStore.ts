import { type RecentAnalysis, isPrivateId } from '@repoready/shared';
import { AnalysisModel, type AnalysisDoc } from '../models/Analysis';
import { ENGINE_VERSION } from '../pipeline/engineVersion';
import type { AnalysisPatch, NewAnalysis, PublicAnalysisStore, StoredAnalysis } from './types';

const OBJECT_ID_RE = /^[a-f0-9]{24}$/;

function fromDoc(doc: AnalysisDoc & { _id: unknown }): StoredAnalysis {
  return {
    id: String(doc._id),
    visibility: 'public',
    owner: doc.owner,
    repo: doc.repo,
    fullName: doc.fullName,
    commitSha: doc.commitSha,
    status: doc.status,
    step: doc.step,
    progress: doc.progress,
    error: doc.error ?? null,
    report: doc.report ?? null,
    scoreTotal: doc.scoreTotal ?? null,
    createdAt: doc.createdAt,
    startedAt: doc.startedAt ?? null,
    finishedAt: doc.finishedAt ?? null,
    expiresAt: doc.expiresAt,
  };
}

// GitHub owner/repo names are case-insensitive.
const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;
// Defense in depth for the public-only queries below: public mode already refuses repos GitHub
// marks private, and private analyses never reach MongoDB, but these reads exclude them anyway.
const NOT_PRIVATE = { 'report.meta.isPrivate': { $ne: true } };

/** Public analyses, persisted in MongoDB. */
export class MongoAnalysisStore implements PublicAnalysisStore {
  readonly visibility = 'public' as const;

  async create(doc: NewAnalysis): Promise<StoredAnalysis> {
    const created = await AnalysisModel.create({
      ...doc,
      status: 'queued',
      engineVersion: ENGINE_VERSION,
    });
    return fromDoc(created.toObject());
  }

  async get(id: string): Promise<StoredAnalysis | null> {
    if (!OBJECT_ID_RE.test(id)) return null;
    const doc = await AnalysisModel.findById(id).lean<AnalysisDoc & { _id: unknown }>();
    return doc ? fromDoc(doc) : null;
  }

  async update(id: string, patch: AnalysisPatch): Promise<void> {
    // Guard rail: private reports must never reach MongoDB, even through a routing bug.
    if (isPrivateId(id)) throw new Error('Refusing to write a private analysis to MongoDB');
    if (!OBJECT_ID_RE.test(id)) return;
    await AnalysisModel.updateOne({ _id: id }, { $set: patch });
  }

  async findReusable(
    fullName: string,
    commitSha: string,
    finishedSince: Date,
  ): Promise<StoredAnalysis | null> {
    const doc = await AnalysisModel.findOne({
      fullName,
      commitSha,
      // Only reuse results produced by the current analyzers.
      engineVersion: ENGINE_VERSION,
      ...NOT_PRIVATE,
      $or: [
        { status: 'done', finishedAt: { $gte: finishedSince } },
        { status: { $in: ['queued', 'running'] } },
      ],
    })
      .collation(CASE_INSENSITIVE)
      .sort({ createdAt: -1 })
      .lean<AnalysisDoc & { _id: unknown }>();
    return doc ? fromDoc(doc) : null;
  }

  async recent(limit: number): Promise<RecentAnalysis[]> {
    const docs = await AnalysisModel.find({ status: 'done', ...NOT_PRIVATE })
      .sort({ finishedAt: -1 })
      .limit(limit * 5)
      .select({ fullName: 1, scoreTotal: 1, createdAt: 1 })
      .lean<{ _id: unknown; fullName: string; scoreTotal: number | null; createdAt: Date }[]>();
    // One entry per repo: the most recent analysis.
    const seen = new Set<string>();
    const out: RecentAnalysis[] = [];
    for (const d of docs) {
      const key = d.fullName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: String(d._id),
        fullName: d.fullName,
        score: d.scoreTotal ?? null,
        createdAt: d.createdAt.toISOString(),
      });
      if (out.length === limit) break;
    }
    return out;
  }

  async latestScore(fullName: string): Promise<number | null> {
    const doc = await AnalysisModel.findOne({ fullName, status: 'done', ...NOT_PRIVATE })
      .collation(CASE_INSENSITIVE)
      .sort({ finishedAt: -1 })
      .select({ scoreTotal: 1 })
      .lean<{ scoreTotal: number | null }>();
    return doc?.scoreTotal ?? null;
  }
}

/** Boot-time cleanup: jobs that were queued/running when the server stopped can never finish. */
export async function failStaleAnalyses(): Promise<number> {
  const result = await AnalysisModel.updateMany(
    { status: { $in: ['queued', 'running'] } },
    {
      $set: {
        status: 'failed',
        error: {
          code: 'ANALYSIS_FAILED',
          message: 'The server restarted before this analysis finished. Please run it again.',
        },
        finishedAt: new Date(),
      },
    },
  );
  return result.modifiedCount;
}

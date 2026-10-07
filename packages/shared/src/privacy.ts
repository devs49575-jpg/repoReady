import type { PrivacyInfo } from './report';

/** Private report ids are `p_` + nanoid(32); everything else is a public (MongoDB) id. */
export const PRIVATE_ID_PREFIX = 'p_';

export function isPrivateId(id: string): boolean {
  return id.startsWith(PRIVATE_ID_PREFIX);
}

export const PUBLIC_PRIVACY: PrivacyInfo = Object.freeze({
  visibility: 'public',
  expiresAt: null,
  externalLookups: true,
});

/** Reads a report's privacy info, treating reports stored before Addendum 01 as public. */
export function getPrivacy(
  report: { privacy?: PrivacyInfo | null } | null | undefined,
): PrivacyInfo {
  return report?.privacy ?? PUBLIC_PRIVACY;
}

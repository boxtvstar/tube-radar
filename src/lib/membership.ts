export type MembershipStatus = 'pending' | 'trial' | 'silver' | 'gold' | 'platinum';
export type EffectiveAccessStatus = MembershipStatus | 'admin';

export const ADMIN_EMAIL = 'boxtvstar@gmail.com';

export const normalizeTierText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s_-]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

export const resolveStatusFromTier = (value: unknown): Exclude<MembershipStatus, 'pending' | 'trial'> | null => {
  const tier = normalizeTierText(value);
  if (!tier) return null;
  if (tier.includes('platinum') || tier.includes('플래티넘')) return 'platinum';
  if (tier.includes('gold') || tier.includes('골드') || tier.includes('pro') || tier.includes('vip')) return 'gold';
  if (tier.includes('silver') || tier.includes('실버') || tier.includes('regular')) return 'silver';
  return null;
};

export const deriveStatusFromLegacy = (data: Record<string, any> | undefined | null): MembershipStatus => {
  if (!data) return 'pending';

  const status = data.status;
  if (status === 'pending' || status === 'trial' || status === 'silver' || status === 'gold' || status === 'platinum') {
    return status;
  }

  const trialExpiresAt = data.trialExpiresAt ? new Date(data.trialExpiresAt).getTime() : 0;
  if (data.trialStatus === 'active' && trialExpiresAt > Date.now()) return 'trial';

  if (data.plan === 'platinum') return 'platinum';
  if (data.plan === 'gold' || data.role === 'pro') return 'gold';
  if (data.plan === 'silver' || data.role === 'regular') return 'silver';
  if (data.role === 'approved') return 'pending';

  return 'pending';
};

export const getEffectiveStatus = (
  status: MembershipStatus | null | undefined,
  email?: string | null
): EffectiveAccessStatus => {
  if (email && email === ADMIN_EMAIL) return 'admin';
  return status || 'pending';
};

export const getLegacyRoleFromStatus = (
  status: MembershipStatus,
  email?: string | null
): 'admin' | 'approved' | 'pending' | 'regular' | 'pro' => {
  if (email && email === ADMIN_EMAIL) return 'admin';
  if (status === 'pending') return 'pending';
  if (status === 'trial') return 'approved';
  if (status === 'silver') return 'regular';
  return 'pro';
};

export const getLegacyPlanFromStatus = (status: MembershipStatus): 'free' | 'silver' | 'gold' | 'platinum' => {
  if (status === 'silver' || status === 'trial') return 'silver';
  if (status === 'gold') return 'gold';
  if (status === 'platinum') return 'platinum';
  return 'free';
};

export const hasSilverAccess = (status: EffectiveAccessStatus | string | null | undefined) =>
  status === 'admin' || status === 'trial' || status === 'silver' || status === 'gold' || status === 'platinum';

export const hasGoldAccess = (status: EffectiveAccessStatus | string | null | undefined) =>
  status === 'admin' || status === 'gold' || status === 'platinum';

export const getDailyPointLimit = (status: EffectiveAccessStatus | string | null | undefined) => {
  if (status === 'admin') return 10000;
  if (status === 'platinum') return 7000;
  if (status === 'gold') return 5000;
  if (status === 'silver' || status === 'trial') return 2000;
  return 1000;
};

export const getDisplayLabelFromStatus = (status: EffectiveAccessStatus | string | null | undefined) => {
  if (status === 'admin') return '관리자';
  if (status === 'trial') return '무료체험';
  if (status === 'silver') return '실버';
  if (status === 'gold') return '골드';
  if (status === 'platinum') return '플래티넘';
  return '대기';
};

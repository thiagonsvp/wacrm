import {
  BadgeCheck,
  BarChart3,
  ShieldCheck,
  Building2,
  FileText,
  Megaphone,
  MessageCircle,
  KeyRound,
  Palette,
  PlugZap,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail. The URL query param
 * stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'profile',
  'appearance',
  'templates',
  'quick-replies',
  'fields',
  'whatsapp',
  'direct',
  'meta-ads',
  'windsor',
  'meta-approvals',
  'api',
  'company',
  'members',
  'permissions',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'profile';

/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'account' | 'conversation' | 'settings' | 'admin';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account' },
  templates: { id: 'templates', label: 'Templates', icon: FileText, group: 'conversation' },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'conversation' },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'conversation' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'settings' },
  direct: { id: 'direct', label: 'Instagram & Messenger', icon: MessageCircle, group: 'settings' },
  'meta-ads': {
    id: 'meta-ads',
    label: 'Meta Ads',
    icon: Megaphone,
    group: 'settings',
  },
  windsor: { id: 'windsor', label: 'Relatórios de performance', icon: BarChart3, group: 'settings' },
  'meta-approvals': {
    id: 'meta-approvals',
    label: 'Aprovar conversoes',
    icon: BadgeCheck,
    group: 'settings',
  },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'settings' },
  company: { id: 'company', label: 'Company', icon: Building2, group: 'admin' },
  members: { id: 'members', label: 'Team members', icon: UsersRound, group: 'admin' },
  permissions: { id: 'permissions', label: 'Perfis e permissoes', icon: ShieldCheck, group: 'admin' },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: 'Account', group: 'account' },
  { label: 'Conversation settings', group: 'conversation' },
  { label: 'Account settings', group: 'settings' },
  { label: 'Administrator settings', group: 'admin' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Profile landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (raw === 'security') return 'profile';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}

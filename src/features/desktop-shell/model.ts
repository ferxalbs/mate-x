import type { AuditFinding, AuditReport } from '../../contracts/audit';
import type { Conversation } from '../../contracts/chat';
import type { WorkspaceSummary } from '../../contracts/workspace';

export interface SidebarFactItem {
  id: string;
  label: string;
  value: string;
  tone?: 'default' | 'critical' | 'warning';
}

export interface SidebarSection {
  id: string;
  title: string;
  items: SidebarFactItem[];
}

export function buildSidebarSections(
  workspace: WorkspaceSummary | null,
  conversation: Conversation,
): SidebarSection[] {
  const latestReport = getLatestReport(conversation);
  const sections: SidebarSection[] = [];

  sections.push({
    id: 'thread',
    title: 'Thread',
    items: [
      {
        id: 'thread-title',
        label: 'Title',
        value: conversation.title,
      },
      {
        id: 'message-count',
        label: 'Messages',
        value: String(conversation.messages.length),
      },
      {
        id: 'updated-at',
        label: 'Updated',
        value: formatRelativeTimestamp(conversation.lastUpdatedAt),
      },
    ],
  });

  if (workspace) {
    sections.push({
      id: 'workspace',
      title: 'Workspace',
      items: [
        {
          id: 'workspace-name',
          label: 'Project',
          value: workspace.name,
        },
        {
          id: 'workspace-branch',
          label: 'Branch',
          value: workspace.branch,
        },
        ...workspace.facts.map((fact) => ({
          id: `fact-${fact.label}`,
          label: fact.label,
          value: fact.value,
        })),
      ],
    });
  }

  if (latestReport) {
    sections.push({
      id: 'report',
      title: 'Latest Audit',
      items: [
        {
          id: 'headline',
          label: 'Headline',
          value: latestReport.headline,
          tone: latestReport.findings[0]?.severity === 'critical' ? 'critical' : 'default',
        },
        {
          id: 'checked-areas',
          label: 'Checked',
          value: latestReport.checkedAreas.join(', '),
        },
        ...latestReport.findings.slice(0, 3).map(mapFindingToSidebarItem),
      ],
    });
  }

  return sections;
}

function getLatestReport(conversation: Conversation): AuditReport | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const report = conversation.messages[index]?.report;
    if (report) {
      return report;
    }
  }
  return null;
}

function mapFindingToSidebarItem(finding: AuditFinding): SidebarFactItem {
  return {
    id: finding.id,
    label: finding.severity,
    value: finding.title,
    tone:
      finding.severity === 'critical'
        ? 'critical'
        : finding.severity === 'warning'
          ? 'warning'
          : 'default',
  };
}

function formatRelativeTimestamp(input: string) {
  const timestamp = new Date(input).getTime();
  const deltaMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (deltaMinutes < 1) {
    return 'just now';
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

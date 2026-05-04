import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from '../tool-service';
import { PDF, StandardFonts, rgb } from '@libpdf/core';

const execFileAsync = promisify(execFile);

type ReportFinding = {
  severity: 'critical' | 'high' | 'medium';
  title: string;
  detail: string;
  evidence: string[];
  action: string;
};

const riskRank = { critical: 0, high: 1, medium: 2 } as const;

const cleanLines = (stdout: string) => stdout.split('\n').filter(Boolean);

export const pdfReportTool: Tool = {
  name: 'pdf_security_report',
  description: 'Generates a premium, shareable PDF security report summarizing identified risks in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'The directory to audit. Defaults to ".".',
      },
      outputPath: {
        type: 'string',
        description: 'The filename or relative path to save the PDF. Defaults to "security-report.pdf".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const { scope = '.', outputPath = 'security-report.pdf' } = args;
    
    try {
      // Perform security analysis (similar to the standard report tool)
      const { stdout: fileListStdout } = await execFileAsync(
        'rg',
        ['--files', '--', scope],
        { cwd: workspacePath },
      );
      const files = cleanLines(fileListStdout);
      const fileCount = files.length;

      const { stdout: secretsStdout } = await execFileAsync('rg', ['-l', 'AKIA|sk_live_|xox[baprs]', '--', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const secretFiles = cleanLines(secretsStdout);

      const { stdout: sinksStdout } = await execFileAsync('rg', ['-l', 'eval\\(|dangerouslySetInnerHTML|\\.innerHTML\\s*=', '--', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const sinkFiles = cleanLines(sinksStdout);

      const { stdout: configStdout } = await execFileAsync('rg', ['--files', '-g', '*Dockerfile*', '-g', '*docker-compose*', '--', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const configFiles = cleanLines(configStdout);

      const { stdout: placeholderStdout } = await execFileAsync('rg', ['-n', 'REPLACE_ME|your-rainy-host|example\\.com', '--', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const placeholderLines = cleanLines(placeholderStdout);

      const { stdout: networkStdout } = await execFileAsync('rg', ['-n', '169\\.254\\.169\\.254|127\\.0\\.0\\.1|0\\.0\\.0\\.0|10\\.[0-9]+\\.[0-9]+\\.[0-9]+|192\\.168\\.[0-9]+\\.[0-9]+', '--', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const networkLines = cleanLines(networkStdout);

      const findings: ReportFinding[] = [
        ...(secretFiles.length > 0 ? [{
          severity: 'critical' as const,
          title: 'Potential hardcoded secret material',
          detail: `${secretFiles.length} file(s) matched high-signal secret token patterns.`,
          evidence: secretFiles.slice(0, 6),
          action: 'Rotate exposed credentials if real, move secrets to secure settings, and add pre-commit secret scanning.',
        }] : []),
        ...(placeholderLines.length > 0 ? [{
          severity: 'high' as const,
          title: 'Placeholder network configuration in source',
          detail: `${placeholderLines.length} placeholder endpoint match(es) found.`,
          evidence: placeholderLines.slice(0, 6),
          action: 'Replace placeholders with validated runtime configuration and fail startup when placeholder values remain.',
        }] : []),
        ...(networkLines.length > 0 ? [{
          severity: 'high' as const,
          title: 'Private or metadata network targets present',
          detail: `${networkLines.length} private, loopback, or metadata endpoint match(es) found.`,
          evidence: networkLines.slice(0, 6),
          action: 'Add SSRF guardrails: domain allowlist, DNS resolution checks, and private/link-local IP blocking.',
        }] : []),
        ...(sinkFiles.length > 0 ? [{
          severity: sinkFiles.length > 5 ? 'high' as const : 'medium' as const,
          title: 'Injection sink patterns',
          detail: `${sinkFiles.length} file(s) contain eval, innerHTML, or dangerous React HTML sinks.`,
          evidence: sinkFiles.slice(0, 6),
          action: 'Review each sink for trusted input boundaries, escaping, and framework-safe alternatives.',
        }] : []),
        ...(configFiles.length > 0 ? [{
          severity: 'medium' as const,
          title: 'Container configuration requires review',
          detail: `${configFiles.length} container manifest(s) found.`,
          evidence: configFiles.slice(0, 6),
          action: 'Check base image pinning, secret mounts, exposed ports, and non-root runtime configuration.',
        }] : []),
      ].sort((a, b) => riskRank[a.severity] - riskRank[b.severity]);

      const riskLevel = findings[0]?.severity.toUpperCase() ?? 'LOW';

      // Generate the PDF
      const doc = PDF.create();
      let page = doc.addPage();
      
      const { height, width } = page;
      
      // We will use standard fonts
      const helvetica = StandardFonts.Helvetica;
      const helveticaBold = StandardFonts.HelveticaBold;
      
      const ink = rgb(0.08, 0.09, 0.11);
      const muted = rgb(0.38, 0.41, 0.45);
      const rule = rgb(0.78, 0.8, 0.83);
      const margin = 54;
      const maxChars = Math.floor((width - margin * 2) / 5.7);
      let cursorY = height - 56;

      const nextPage = () => {
        page = doc.addPage();
        cursorY = height - 56;
      };

      const ensureSpace = (space: number) => {
        if (cursorY - space < 54) nextPage();
      };

      const wrap = (text: string, max = maxChars) => {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let line = '';
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (next.length > max && line) {
            lines.push(line);
            line = word;
          } else {
            line = next;
          }
        }
        if (line) lines.push(line);
        return lines;
      };

      const text = (value: string, size = 10, bold = false, color = ink, indent = 0) => {
        for (const line of wrap(value, maxChars - Math.floor(indent / 5.7))) {
          ensureSpace(size + 8);
          page.drawText(line, { x: margin + indent, y: cursorY, size, font: bold ? helveticaBold : helvetica, color });
          cursorY -= size + 5;
        }
      };

      const section = (title: string) => {
        ensureSpace(36);
        cursorY -= 8;
        page.drawLine({ start: { x: margin, y: cursorY }, end: { x: width - margin, y: cursorY }, thickness: 1, color: rule });
        cursorY -= 20;
        text(title.toUpperCase(), 11, true, ink);
      };

      text('Security Posture Report', 24, true, ink);
      text(`Scope: ${scope}`, 10, false, muted);
      text(`Files analyzed: ${fileCount}    Assessed risk: ${riskLevel}    Findings: ${findings.length}`, 10, false, muted);

      section('Executive Summary');
      text(findings.length > 0
        ? `MaTE X found ${findings.length} actionable security area(s). Report prioritizes real matched evidence, not generic checklist guidance.`
        : 'No high-signal findings matched this first-pass scan. Continue with targeted audits for authentication, data access, and dependency risk.',
      11);

      section('Findings');
      if (findings.length === 0) {
        text('No reportable findings from current scanners.', 10);
      }
      findings.forEach((finding, index) => {
        ensureSpace(72);
        text(`${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title}`, 12, true);
        text(finding.detail, 10);
        text(`Fix: ${finding.action}`, 10);
        finding.evidence.forEach(item => text(`Evidence: ${item}`, 9, false, muted, 12));
        cursorY -= 8;
      });

      section('Recommended Work Plan');
      const recommendations = findings.length > 0
        ? findings.map((finding, index) => `${index + 1}. ${finding.action}`)
        : ['1. Run focused audits for secrets, auth, data access, outbound network calls, and packaging configuration.'];
      recommendations.forEach(item => text(item, 10));

      // Save the PDF
      const pdfBytes = await doc.save();
      const absolutePath = path.resolve(workspacePath, outputPath);
      await fs.writeFile(absolutePath, pdfBytes);

      return `Successfully generated premium PDF security report at: ${absolutePath}`;
    } catch (error) {
      return `Error generating PDF security report: ${(error as Error).message}`;
    }
  },
};

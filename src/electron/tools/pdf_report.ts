import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from '../tool-service';
import { PDF, StandardFonts, rgb } from '@libpdf/core';

const execFileAsync = promisify(execFile);

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
      const fileCount = fileListStdout.split('\n').filter(Boolean).length;

      const { stdout: secretsStdout } = await execFileAsync('rg', ['-l', 'AKIA|sk_live_|xox[baprs]', '--', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const secretFiles = secretsStdout.split('\n').filter(Boolean);

      const { stdout: sinksStdout } = await execFileAsync('rg', ['-l', 'eval\\(|dangerouslySetInnerHTML|\\.innerHTML\\s*=', '--', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const sinkFiles = sinksStdout.split('\n').filter(Boolean);

      const { stdout: configStdout } = await execFileAsync('rg', ['--files', '-g', '*Dockerfile*', '-g', '*docker-compose*', '--', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const configFiles = configStdout.split('\n').filter(Boolean);

      const isCritical = secretFiles.length > 0;
      const isHigh = sinkFiles.length > 5;
      const riskLevel = isCritical ? 'CRITICAL' : (isHigh ? 'HIGH' : 'MEDIUM');

      // Generate the PDF
      const doc = PDF.create();
      const page = doc.addPage();
      
      const { height } = page;
      
      // We will use standard fonts
      const helvetica = StandardFonts.Helvetica;
      const helveticaBold = StandardFonts.HelveticaBold;
      
      let cursorY = height - 50;
      
      // Title
      page.drawText('EXECUTIVE SECURITY REPORT', {
        x: 50,
        y: cursorY,
        size: 24,
        font: helveticaBold,
        color: rgb(0.1, 0.1, 0.4),
      });
      cursorY -= 40;

      // Overview
      page.drawText(`Scope: ${scope}`, { x: 50, y: cursorY, size: 12, font: helvetica });
      cursorY -= 20;
      page.drawText(`Total Files Analyzed: ${fileCount}`, { x: 50, y: cursorY, size: 12, font: helvetica });
      cursorY -= 20;
      
      const riskColor = isCritical ? rgb(0.8, 0.1, 0.1) : (isHigh ? rgb(0.8, 0.4, 0.1) : rgb(0.1, 0.6, 0.1));
      page.drawText(`Assessed Risk Level: ${riskLevel}`, { x: 50, y: cursorY, size: 14, font: helveticaBold, color: riskColor });
      cursorY -= 40;

      // Critical Issues
      page.drawText('CRITICAL ISSUES', { x: 50, y: cursorY, size: 16, font: helveticaBold, color: rgb(0.8, 0.1, 0.1) });
      cursorY -= 20;
      const secretsText = secretFiles.length > 0 ? `- Found potential hardcoded secrets in ${secretFiles.length} file(s).` : '- No obvious hardcoded secrets detected in first-pass scan.';
      page.drawText(secretsText, { x: 50, y: cursorY, size: 12, font: helvetica });
      cursorY -= 40;

      // High Risk Patterns
      page.drawText('HIGH RISK PATTERNS', { x: 50, y: cursorY, size: 16, font: helveticaBold, color: rgb(0.8, 0.4, 0.1) });
      cursorY -= 20;
      const sinksText = sinkFiles.length > 0 ? `- Identified dangerous injection sinks in ${sinkFiles.length} file(s).` : '- No critical injection sinks found in standard patterns.';
      page.drawText(sinksText, { x: 50, y: cursorY, size: 12, font: helvetica });
      cursorY -= 40;

      // Infrastructure Findings
      page.drawText('INFRASTRUCTURE FINDINGS', { x: 50, y: cursorY, size: 16, font: helveticaBold, color: rgb(0.2, 0.2, 0.8) });
      cursorY -= 20;
      const configText = configFiles.length > 0 ? `- Detected ${configFiles.length} container configuration file(s). Audit recommended.` : '- No container manifests found in specified scope.';
      page.drawText(configText, { x: 50, y: cursorY, size: 12, font: helvetica });
      cursorY -= 40;

      // Recommended Next Steps
      page.drawText('RECOMMENDED NEXT STEPS', { x: 50, y: cursorY, size: 16, font: helveticaBold });
      cursorY -= 20;
      page.drawText('1. Use \'secret_scan\' for a deep-dive into the identified secret-bearing files.', { x: 50, y: cursorY, size: 12, font: helvetica });
      cursorY -= 20;
      page.drawText('2. Use \'sql_audit\' to check database interaction logic.', { x: 50, y: cursorY, size: 12, font: helvetica });
      cursorY -= 20;
      page.drawText('3. Use \'auth_audit\' to verify your route protection middleware is consistent.', { x: 50, y: cursorY, size: 12, font: helvetica });

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

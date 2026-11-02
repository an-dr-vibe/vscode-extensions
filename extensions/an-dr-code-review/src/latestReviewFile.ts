import * as vscode from 'vscode';
import { ReviewData, StoredThread, getStorageDirSetting } from './reviewStore';

export const LATEST_REVIEW_FILE_NAME = 'tmp-code-review-latest.md';
/** The name before tmp-code-review-latest.md; removed on sync so only one copy remains. */
const PREVIOUS_LATEST_REVIEW_FILE_NAME = 'temp-code-review-latest.md';

export type UrlBuilder = (file: string, startLine: number, endLine: number) => string | null;

function lineRef(thread: StoredThread): string {
    const start = thread.line + 1;
    const end = thread.endLine + 1;
    return start === end ? `${thread.file}:${start}` : `${thread.file}:${start}-${end}`;
}

/**
 * Renders the open review threads as a to-do list for whoever addresses them, a person
 * or an agent, with the instruction to delete the file once nothing is left.
 */
export function renderLatestReview(data: ReviewData, urlFor: UrlBuilder): string {
    const open = data.threads.filter((thread) => !thread.resolved && thread.comments.length > 0);
    const resolvedCount = data.threads.length - open.length;
    const byFile = new Map<string, StoredThread[]>();
    for (const thread of open) {
        byFile.set(thread.file, [...(byFile.get(thread.file) ?? []), thread]);
    }

    const threadWord = open.length === 1 ? 'entry' : 'entries';
    const fileWord = byFile.size === 1 ? 'file' : 'files';
    const lines: string[] = [
        '# Code review: open entries',
        '',
        '> **Instructions:** address every entry below. When all of them are done, delete this file.',
        '> Do not edit it to track progress: the an-dr: Code Review extension rewrites it after every',
        `> review change from \`${getStorageDirSetting()}/.code-review.json\`, and removes it when no entry is open.`,
        '',
        `${open.length} open ${threadWord} in ${byFile.size} ${fileWord}` + (resolvedCount > 0 ? ` (${resolvedCount} resolved, not listed).` : '.'),
        '',
    ];

    const files = [...byFile.keys()].sort((a, b) => a.localeCompare(b));
    let number = 0;
    for (const file of files) {
        lines.push(`## \`${file}\``, '');
        for (const thread of byFile.get(file)!.sort((a, b) => a.line - b.line)) {
            number += 1;
            const url = urlFor(thread.file, thread.line, thread.endLine);
            lines.push(`### ${number}. \`${lineRef(thread)}\`` + (url ? ` · [view online](${url})` : ''), '');
            for (const comment of thread.comments) {
                if (comment.author) {
                    lines.push(`**${comment.author}:**`, '');
                }
                lines.push(comment.body, '');
            }
        }
    }
    return lines.join('\n');
}

/**
 * Writes the latest-review file to the workspace root, or removes it when no thread is
 * open. Does nothing when `codeReview.latestMarkdown` is off.
 */
export async function syncLatestReviewFile(data: ReviewData, urlFor: UrlBuilder): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root || !vscode.workspace.getConfiguration('codeReview').get<boolean>('latestMarkdown', true)) {
        return;
    }
    const uri = vscode.Uri.joinPath(root, LATEST_REVIEW_FILE_NAME);
    try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, PREVIOUS_LATEST_REVIEW_FILE_NAME));
    } catch {
        // Never written, or already gone.
    }
    const hasOpen = data.threads.some((thread) => !thread.resolved && thread.comments.length > 0);
    if (!hasOpen) {
        try {
            await vscode.workspace.fs.delete(uri);
        } catch {
            // Already gone.
        }
        return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(renderLatestReview(data, urlFor), 'utf8'));
}

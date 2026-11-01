import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import {
    StoredComment,
    StoredThread,
    ReviewData,
    ensureStorageDir,
    fireReviewDataChanged,
    getStorageDirSetting,
    getStorageDirUri,
    isReviewDataCorrupt,
    onDidChangeReviewData,
    loadReviewData,
    saveReviewData,
    relativeFilePath,
    watchReviewData,
} from './reviewStore';
import { UrlBuilder, syncLatestReviewFile } from './latestReviewFile';

class ReviewComment implements vscode.Comment {
    id: string;
    body: string | vscode.MarkdownString;
    mode = vscode.CommentMode.Preview;
    author: vscode.CommentAuthorInformation;
    timestamp: Date;
    label: string | undefined;
    contextValue = 'reviewComment';
    // The persisted text, restored when an edit is cancelled.
    savedBody: string;

    constructor(stored: StoredComment) {
        this.id = stored.id;
        this.savedBody = stored.body;
        this.body = new vscode.MarkdownString(stored.body);
        this.author = { name: stored.author ?? '' };
        this.timestamp = new Date(stored.timestamp);
        this.label = stored.edited ? 'edited' : undefined;
    }

    get text(): string {
        return typeof this.body === 'string' ? this.body : this.body.value;
    }
}

type ExportBehavior = {
    showDocument: boolean;
    showNotification: boolean;
    allowEmpty: boolean;
};

function shouldIncludeExportTimestamp(): boolean {
    return vscode.workspace.getConfiguration('codeReview').get<boolean>('exportCommentTimestamp', true);
}

function getGitCwd(): string | null {
    const local = process.env.LOCAL_WORKSPACE_FOLDER;
    if (local) {
        return local;
    }
    const uri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (uri?.scheme === 'file') {
        return uri.fsPath;
    }
    return null;
}

function gitExec(cmd: string): string {
    const cwd = getGitCwd();
    if (!cwd) {
        return '';
    }
    try {
        return execSync(cmd, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return '';
    }
}

function getAuthor(): string {
    const cfg = vscode.workspace.getConfiguration('codeReview');
    const val = cfg.get<string>('author', '').trim();
    if (val) {
        return val;
    }
    const name = gitExec('git config user.name');
    if (name) {
        return name;
    }
    return process.env.USER ?? process.env.USERNAME ?? 'unknown';
}

function resolveSymlink(relFile: string): string {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) {
        return relFile;
    }
    try {
        const realAbs = fs.realpathSync(path.join(wsRoot, relFile));
        const resolved = path.relative(wsRoot, realAbs).replace(/\\/g, '/');
        return resolved.startsWith('..') ? relFile : resolved;
    } catch {
        return relFile;
    }
}

function createUrlBuilder(): UrlBuilder {
    const remote = gitExec('git remote get-url origin');
    let base: string | null = null;
    const ssh = remote.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/);
    const https = remote.match(/^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?$/);
    if (ssh) {
        base = `https://${ssh[1]}/${ssh[2]}`;
    } else if (https) {
        base = `https://${https[1]}`;
    }
    if (!base) {
        return () => null;
    }
    const branch = gitExec('git rev-parse --abbrev-ref HEAD') || 'main';
    const isGitLab = base.includes('gitlab');
    const blob = isGitLab ? '-/blob' : 'blob';
    return (file, startLine, endLine) => {
        const anchor = isGitLab
            ? `#L${startLine + 1}-${endLine + 1}`
            : `#L${startLine + 1}-L${endLine + 1}`;
        return `${base}/${blob}/${branch}/${resolveSymlink(file)}${anchor}`;
    };
}

async function writeMarkdownExport(data: ReviewData, behavior: ExportBehavior, urlFor: UrlBuilder = createUrlBuilder()): Promise<void> {
    if (data.threads.length === 0 && !behavior.allowEmpty) {
        vscode.window.showInformationMessage('Code Review: no comments to export.');
        return;
    }
    const byFile = new Map<string, StoredThread[]>();
    for (const thread of data.threads) {
        if (!byFile.has(thread.file)) {
            byFile.set(thread.file, []);
        }
        byFile.get(thread.file)!.push(thread);
    }

    const lines: string[] = [
        '# Code Review',
        '',
        `*Exported: ${new Date().toISOString().split('T')[0]}*`,
        '',
    ];

    for (const [file, threads] of byFile) {
        lines.push(`## \`${file}\``, '');
        for (const thread of threads.sort((a, b) => a.line - b.line)) {
            const startLine = thread.line + 1;
            const endLine = thread.endLine + 1;
            const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
            const url = urlFor(thread.file, thread.line, thread.endLine);
            const linkPart = url ? ` · [View online](${url})` : '';
            const resolvedPart = thread.resolved ? ' ✅' : '';
            lines.push(`### ${lineLabel}${resolvedPart}${linkPart}`, '');
            for (const comment of thread.comments) {
                const metaParts: string[] = [];
                if (comment.author) {
                    metaParts.push(`**${comment.author}**`);
                }
                if (shouldIncludeExportTimestamp()) {
                    metaParts.push(`*${new Date(comment.timestamp).toLocaleString()}*`);
                }
                if (metaParts.length > 0) {
                    lines.push(metaParts.join(' · '), '');
                }
                lines.push(comment.body, '');
            }
            lines.push('---', '');
        }
    }

    const dirUri = getStorageDirUri();
    if (!dirUri) {
        return;
    }
    await ensureStorageDir();
    const outUri = vscode.Uri.joinPath(dirUri, 'code-review.md');
    await vscode.workspace.fs.writeFile(outUri, Buffer.from(lines.join('\n'), 'utf8'));
    if (behavior.showDocument) {
        const doc = await vscode.workspace.openTextDocument(outUri);
        await vscode.window.showTextDocument(doc);
    }
    if (behavior.showNotification) {
        vscode.window.showInformationMessage(`Code review exported to ${getStorageDirSetting()}/code-review.md`);
    }
}

async function writeJiraExport(data: ReviewData, behavior: ExportBehavior, urlFor: UrlBuilder = createUrlBuilder()): Promise<void> {
    if (data.threads.length === 0 && !behavior.allowEmpty) {
        vscode.window.showInformationMessage('Code Review: no comments to export.');
        return;
    }
    const byFile = new Map<string, StoredThread[]>();
    for (const thread of data.threads) {
        if (!byFile.has(thread.file)) {
            byFile.set(thread.file, []);
        }
        byFile.get(thread.file)!.push(thread);
    }

    const lines: string[] = [
        'h1. Code Review',
        `_Exported: ${new Date().toISOString().split('T')[0]}_`,
        '',
    ];

    for (const [file, threads] of byFile) {
        lines.push(`h2. {{${file}}}`, '');
        for (const thread of threads.sort((a, b) => a.line - b.line)) {
            const startLine = thread.line + 1;
            const endLine = thread.endLine + 1;
            const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
            const url = urlFor(thread.file, thread.line, thread.endLine);
            const linkPart = url ? ` | [View online|${url}]` : '';
            const resolvedPart = thread.resolved ? ' (resolved)' : '';
            lines.push(`h3. ${lineLabel}${resolvedPart}${linkPart}`, '');
            for (const comment of thread.comments) {
                const metaParts: string[] = [];
                if (comment.author) {
                    metaParts.push(`*${comment.author}*`);
                }
                if (shouldIncludeExportTimestamp()) {
                    metaParts.push(`_${new Date(comment.timestamp).toLocaleString()}_`);
                }
                if (metaParts.length > 0) {
                    lines.push(metaParts.join(' | '), '');
                }
                lines.push(comment.body, '');
            }
            lines.push('----', '');
        }
    }

    const dirUri = getStorageDirUri();
    if (!dirUri) {
        return;
    }
    await ensureStorageDir();
    const outUri = vscode.Uri.joinPath(dirUri, 'code-review.jira');
    await vscode.workspace.fs.writeFile(outUri, Buffer.from(lines.join('\n'), 'utf8'));
    if (behavior.showDocument) {
        const doc = await vscode.workspace.openTextDocument(outUri);
        await vscode.window.showTextDocument(doc);
    }
    if (behavior.showNotification) {
        vscode.window.showInformationMessage(`Code review exported to ${getStorageDirSetting()}/code-review.jira`);
    }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

// Keeps every derived file in step with the review data: the auto-exports and the
// latest-review file. Runs after each change and when a related setting changes.
async function syncDerivedFiles(): Promise<void> {
    const dirUri = getStorageDirUri();
    if (!dirUri) {
        return;
    }
    const data = await loadReviewData();
    // An unreadable data file loads as empty; deriving from it would wipe the exports.
    if (isReviewDataCorrupt()) {
        return;
    }
    const urlFor = createUrlBuilder();
    const behavior: ExportBehavior = {
        showDocument: false,
        showNotification: false,
        allowEmpty: true,
    };

    // With no comments, refresh an export that already exists (so it does not keep the
    // last deleted comment) but do not create one.
    const autoExport = vscode.workspace.getConfiguration('codeReview').get<string>('autoExport', 'none');
    const empty = data.threads.length === 0;
    if ((autoExport === 'markdown' || autoExport === 'both')
        && (!empty || await fileExists(vscode.Uri.joinPath(dirUri, 'code-review.md')))) {
        await writeMarkdownExport(data, behavior, urlFor);
    }
    if ((autoExport === 'jira' || autoExport === 'both')
        && (!empty || await fileExists(vscode.Uri.joinPath(dirUri, 'code-review.jira')))) {
        await writeJiraExport(data, behavior, urlFor);
    }
    await syncLatestReviewFile(data, urlFor);
}

// Serialises syncs so two quick changes never interleave their writes.
let syncChain: Promise<void> = Promise.resolve();

function scheduleDerivedFilesSync(): void {
    syncChain = syncChain
        .then(syncDerivedFiles)
        .catch((error) => console.error('Code Review: updating derived files failed', error));
}

export function activateCommentController(context: vscode.ExtensionContext): void {
    const ctrl = vscode.comments.createCommentController('an-dr-code-review', 'Code Review');
    context.subscriptions.push(ctrl);

    ctrl.commentingRangeProvider = {
        provideCommentingRanges(doc) {
            return [new vscode.Range(0, 0, doc.lineCount - 1, 0)];
        },
    };

    const threadToId = new WeakMap<vscode.CommentThread, string>();
    const idToThread = new Map<string, vscode.CommentThread>();

    async function restoreThreads(): Promise<void> {
        for (const thread of idToThread.values()) {
            thread.dispose();
        }
        idToThread.clear();

        const data = await loadReviewData();
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root) {
            return;
        }

        for (const stored of data.threads) {
            const uri = vscode.Uri.joinPath(root, stored.file);
            const range = new vscode.Range(stored.line, 0, stored.endLine, 0);
            const comments = stored.comments.map((comment) => new ReviewComment(comment));
            const thread = ctrl.createCommentThread(uri, range, comments);
            thread.label = 'Code Review';
            thread.canReply = true;
            thread.contextValue = stored.resolved ? 'resolved' : 'unresolved';
            thread.collapsibleState = stored.resolved
                ? vscode.CommentThreadCollapsibleState.Collapsed
                : vscode.CommentThreadCollapsibleState.Expanded;

            threadToId.set(thread, stored.id);
            idToThread.set(stored.id, thread);
        }
    }

    void restoreThreads();
    scheduleDerivedFilesSync();
    context.subscriptions.push(onDidChangeReviewData(scheduleDerivedFilesSync));

    context.subscriptions.push(watchReviewData(() => {
        void restoreThreads();
        fireReviewDataChanged();
    }));

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration('codeReview.autoExport') ||
                event.affectsConfiguration('codeReview.latestMarkdown') ||
                event.affectsConfiguration('codeReview.exportCommentTimestamp') ||
                event.affectsConfiguration('codeReview.storageDir')
            ) {
                scheduleDerivedFilesSync();
            }
        })
    );

    async function handleSubmit(reply: vscode.CommentReply | undefined): Promise<void> {
        if (!reply?.thread) {
            return;
        }
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root) {
            return;
        }
        const body = reply.text.trim();
        if (!body) {
            return;
        }
        const range = reply.thread.range;
        if (!range) {
            return;
        }

        const data = await loadReviewData();
        const relFile = relativeFilePath(root, reply.thread.uri);

        let threadId = threadToId.get(reply.thread);
        let stored = threadId ? data.threads.find((thread) => thread.id === threadId) : undefined;

        if (!stored) {
            threadId = randomUUID();
            stored = {
                id: threadId,
                file: relFile,
                line: range.start.line,
                endLine: range.end.line,
                resolved: false,
                comments: [],
            };
            data.threads.push(stored);
            threadToId.set(reply.thread, threadId);
            idToThread.set(threadId, reply.thread);
            reply.thread.label = 'Code Review';
            reply.thread.canReply = true;
            reply.thread.contextValue = 'unresolved';
        }

        const cfg = vscode.workspace.getConfiguration('codeReview');
        const newComment: StoredComment = {
            id: randomUUID(),
            ...(cfg.get<boolean>('showAuthor', false) && { author: getAuthor() }),
            body,
            timestamp: new Date().toISOString(),
        };
        stored.comments.push(newComment);
        await saveReviewData(data);

        reply.thread.comments = [...reply.thread.comments, new ReviewComment(newComment)];
        reply.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }

    async function handleDeleteComment(comment: ReviewComment): Promise<void> {
        const data = await loadReviewData();
        for (const stored of data.threads) {
            const idx = stored.comments.findIndex((item) => item.id === comment.id);
            if (idx === -1) {
                continue;
            }

            stored.comments.splice(idx, 1);
            const thread = idToThread.get(stored.id);
            if (stored.comments.length === 0) {
                data.threads.splice(data.threads.indexOf(stored), 1);
            }
            await saveReviewData(data);
            if (thread) {
                thread.comments = thread.comments.filter((item) => (item as ReviewComment).id !== comment.id);
                if (thread.comments.length === 0) {
                    idToThread.delete(stored.id);
                    thread.dispose();
                }
            }
            return;
        }
    }

    function findThreadOf(comment: ReviewComment): vscode.CommentThread | undefined {
        for (const thread of idToThread.values()) {
            if (thread.comments.some((item) => (item as ReviewComment).id === comment.id)) {
                return thread;
            }
        }
        return undefined;
    }

    // Reassigning the array is what makes VS Code re-render a changed comment.
    function setMode(comment: ReviewComment, mode: vscode.CommentMode): void {
        const thread = findThreadOf(comment);
        if (!thread) {
            return;
        }
        thread.comments = thread.comments.map((item) => {
            if ((item as ReviewComment).id === comment.id) {
                item.mode = mode;
            }
            return item;
        });
    }

    function handleEditComment(comment: ReviewComment): void {
        comment.body = comment.savedBody;
        setMode(comment, vscode.CommentMode.Editing);
    }

    function handleCancelEdit(comment: ReviewComment): void {
        comment.body = new vscode.MarkdownString(comment.savedBody);
        setMode(comment, vscode.CommentMode.Preview);
    }

    async function handleSaveComment(comment: ReviewComment): Promise<void> {
        const body = comment.text.trim();
        if (!body || body === comment.savedBody) {
            handleCancelEdit(comment);
            return;
        }
        const data = await loadReviewData();
        const stored = data.threads.flatMap((thread) => thread.comments).find((item) => item.id === comment.id);
        if (!stored) {
            handleCancelEdit(comment);
            return;
        }
        stored.body = body;
        stored.edited = new Date().toISOString();
        await saveReviewData(data);
        comment.savedBody = body;
        comment.label = 'edited';
        handleCancelEdit(comment);
    }

    async function handleClearAll(): Promise<void> {
        const data = await loadReviewData();
        const commentCount = data.threads.reduce((sum, thread) => sum + thread.comments.length, 0);
        if (data.threads.length === 0) {
            vscode.window.showInformationMessage('Code Review: there are no comments to clear.');
            return;
        }
        const threadLabel = data.threads.length === 1 ? '1 thread' : `${data.threads.length} threads`;
        const commentLabel = commentCount === 1 ? '1 comment' : `${commentCount} comments`;
        const choice = await vscode.window.showWarningMessage(
            `Delete all ${commentLabel} in ${threadLabel}?`,
            { modal: true, detail: 'This removes every review comment in the workspace and cannot be undone.' },
            'Delete All',
        );
        if (choice !== 'Delete All') {
            return;
        }
        await saveReviewData({ ...data, threads: [] });
        for (const thread of idToThread.values()) {
            thread.dispose();
        }
        idToThread.clear();
    }

    const updateHasComments = async () => {
        const data = await loadReviewData();
        await vscode.commands.executeCommand('setContext', 'anDrCodeReview.hasComments', data.threads.length > 0);
    };
    void updateHasComments();
    context.subscriptions.push(onDidChangeReviewData(() => void updateHasComments()));

    async function setResolved(thread: vscode.CommentThread, resolved: boolean): Promise<void> {
        const threadId = threadToId.get(thread);
        if (!threadId) {
            return;
        }
        const data = await loadReviewData();
        const stored = data.threads.find((item) => item.id === threadId);
        if (!stored) {
            return;
        }
        stored.resolved = resolved;
        await saveReviewData(data);
        thread.contextValue = resolved ? 'resolved' : 'unresolved';
        thread.collapsibleState = resolved
            ? vscode.CommentThreadCollapsibleState.Collapsed
            : vscode.CommentThreadCollapsibleState.Expanded;
    }

    async function handleDeleteThread(thread: vscode.CommentThread): Promise<void> {
        const threadId = threadToId.get(thread);
        if (threadId) {
            const data = await loadReviewData();
            const idx = data.threads.findIndex((item) => item.id === threadId);
            if (idx !== -1) {
                data.threads.splice(idx, 1);
            }
            await saveReviewData(data);
            idToThread.delete(threadId);
        }
        thread.dispose();
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('an-dr-code-review.submitComment', (reply: vscode.CommentReply) => handleSubmit(reply)),
        vscode.commands.registerCommand('an-dr-code-review.deleteComment', (comment: ReviewComment) => handleDeleteComment(comment)),
        vscode.commands.registerCommand('an-dr-code-review.resolveThread', (thread: vscode.CommentThread) => setResolved(thread, true)),
        vscode.commands.registerCommand('an-dr-code-review.unresolveThread', (thread: vscode.CommentThread) => setResolved(thread, false)),
        vscode.commands.registerCommand('an-dr-code-review.deleteThread', (thread: vscode.CommentThread) => handleDeleteThread(thread)),
        vscode.commands.registerCommand('an-dr-code-review.editComment', (comment: ReviewComment) => handleEditComment(comment)),
        vscode.commands.registerCommand('an-dr-code-review.saveComment', (comment: ReviewComment) => handleSaveComment(comment)),
        vscode.commands.registerCommand('an-dr-code-review.cancelEditComment', (comment: ReviewComment) => handleCancelEdit(comment)),
        vscode.commands.registerCommand('an-dr-code-review.clearAllComments', () => handleClearAll()),
        vscode.commands.registerCommand('an-dr-code-review.exportMarkdown', async () => writeMarkdownExport(await loadReviewData(), {
            showDocument: true,
            showNotification: true,
            allowEmpty: false,
        })),
        vscode.commands.registerCommand('an-dr-code-review.exportJira', async () => writeJiraExport(await loadReviewData(), {
            showDocument: true,
            showNotification: true,
            allowEmpty: false,
        })),
    );
}

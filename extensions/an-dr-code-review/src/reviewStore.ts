import * as vscode from 'vscode';

export interface StoredComment {
    id: string;
    author?: string;
    body: string;
    timestamp: string;
    /** ISO time of the last edit, absent when the comment was never edited. */
    edited?: string;
}

export interface StoredThread {
    id: string;
    file: string;
    line: number;
    endLine: number;
    resolved: boolean;
    comments: StoredComment[];
}

export interface ReviewData {
    version: number;
    threads: StoredThread[];
}

export interface FileCommentEntry {
    file: string;
    line: number;
    endLine: number;
    resolved: boolean;
    comment: StoredComment;
}

export interface FileCommentsGroup {
    file: string;
    entries: FileCommentEntry[];
}

export interface ReviewedFileState {
    checked: boolean;
    outdated: boolean;
    lastReviewedVersion: string;
    timestamp: number;
}

export interface ReviewedFilesData {
    version: number;
    files: Record<string, ReviewedFileState>;
}

const DEFAULT_STORAGE_DIR = '.artifacts-temp';
const LEGACY_STORAGE_DIR = 'code-review';
const DATA_FILE_NAME = '.code-review.json';
const CHECKED_FILES_NAME = '.checked-files.json';
const GITIGNORE_CONTENT = '*\n';

const reviewDataChangedEmitter = new vscode.EventEmitter<void>();
export const onDidChangeReviewData = reviewDataChangedEmitter.event;

export function fireReviewDataChanged(): void {
    reviewDataChangedEmitter.fire();
}

function getRootUri(): vscode.Uri | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
}

/** Workspace-relative storage folder from `codeReview.storageDir`, with separators normalised. */
export function getStorageDirSetting(): string {
    const value = vscode.workspace.getConfiguration('codeReview').get<string>('storageDir', DEFAULT_STORAGE_DIR);
    const trimmed = (value ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return trimmed || DEFAULT_STORAGE_DIR;
}

export function getStorageDirUri(): vscode.Uri | null {
    const root = getRootUri();
    return root ? vscode.Uri.joinPath(root, getStorageDirSetting()) : null;
}

function getDataFileUri(): vscode.Uri | null {
    const dir = getStorageDirUri();
    return dir ? vscode.Uri.joinPath(dir, DATA_FILE_NAME) : null;
}

function getReviewedFilesUri(): vscode.Uri | null {
    const dir = getStorageDirUri();
    return dir ? vscode.Uri.joinPath(dir, CHECKED_FILES_NAME) : null;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
    try {
        return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
        return undefined;
    }
}

// Before codeReview.storageDir existed, data lived in code-review/ (the comments file
// could be moved with the removed codeReview.dataFile setting). Copy it once into the
// new folder so existing reviews survive; the old files stay where they were.
const migratedDirs = new Set<string>();

async function migrateLegacyData(dir: vscode.Uri): Promise<void> {
    const root = getRootUri();
    if (!root || migratedDirs.has(dir.toString())) {
        return;
    }
    migratedDirs.add(dir.toString());

    const legacyDataFile = vscode.workspace.getConfiguration('codeReview').get<string>('dataFile')
        || `${LEGACY_STORAGE_DIR}/${DATA_FILE_NAME}`;
    const pairs: Array<[vscode.Uri, vscode.Uri]> = [
        [vscode.Uri.joinPath(root, legacyDataFile), vscode.Uri.joinPath(dir, DATA_FILE_NAME)],
        [vscode.Uri.joinPath(root, LEGACY_STORAGE_DIR, CHECKED_FILES_NAME), vscode.Uri.joinPath(dir, CHECKED_FILES_NAME)],
    ];
    for (const [from, to] of pairs) {
        if (from.toString() === to.toString() || await exists(to) || !await exists(from)) {
            continue;
        }
        await ensureStorageDir();
        await vscode.workspace.fs.copy(from, to);
    }
}

export async function ensureStorageDir(): Promise<void> {
    const dirUri = getStorageDirUri();
    if (!dirUri) {
        return;
    }
    await vscode.workspace.fs.createDirectory(dirUri);
    const gitignoreUri = vscode.Uri.joinPath(dirUri, '.gitignore');
    if (!await exists(gitignoreUri)) {
        await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(GITIGNORE_CONTENT, 'utf8'));
    }
}

function parseReviewData(text: string): ReviewData | undefined {
    try {
        const parsed = JSON.parse(text) as ReviewData;
        return parsed && Array.isArray(parsed.threads) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

let reportedCorruptText: string | undefined;
let lastLoadCorrupt = false;

/** True when the last load found a data file that is not valid review data. */
export function isReviewDataCorrupt(): boolean {
    return lastLoadCorrupt;
}

function reportCorrupt(uri: vscode.Uri, text: string): void {
    if (reportedCorruptText === text) {
        return;
    }
    reportedCorruptText = text;
    void vscode.window.showErrorMessage(
        `Code Review: ${vscode.workspace.asRelativePath(uri)} is not valid review data. `
        + 'Comments are hidden and nothing will be saved until the file is fixed or removed.'
    );
}

export async function loadReviewData(): Promise<ReviewData> {
    const dir = getStorageDirUri();
    const uri = getDataFileUri();
    if (!dir || !uri) {
        return { version: 1, threads: [] };
    }
    await migrateLegacyData(dir);
    const text = await readText(uri);
    lastLoadCorrupt = false;
    if (text === undefined) {
        return { version: 1, threads: [] };
    }
    const data = parseReviewData(text);
    if (!data) {
        lastLoadCorrupt = true;
        reportCorrupt(uri, text);
        return { version: 1, threads: [] };
    }
    return data;
}

export async function loadReviewedFilesData(): Promise<ReviewedFilesData> {
    const dir = getStorageDirUri();
    const uri = getReviewedFilesUri();
    if (!dir || !uri) {
        return { version: 1, files: {} };
    }
    await migrateLegacyData(dir);
    const text = await readText(uri);
    try {
        const parsed = text === undefined ? undefined : JSON.parse(text) as ReviewedFilesData;
        return parsed && parsed.files && typeof parsed.files === 'object' ? parsed : { version: 1, files: {} };
    } catch {
        return { version: 1, files: {} };
    }
}

// The text this extension last wrote, so the file watcher can tell its own saves
// from changes made outside VS Code.
let lastSavedText: string | undefined;

export async function saveReviewData(data: ReviewData): Promise<void> {
    const uri = getDataFileUri();
    if (!uri) {
        return;
    }
    // Never replace a file that exists but cannot be read back: it may be a hand edit
    // or a merge conflict, and overwriting it would lose every comment in it.
    const current = await readText(uri);
    if (current !== undefined && current.trim() !== '' && !parseReviewData(current)) {
        reportCorrupt(uri, current);
        throw new Error(`${vscode.workspace.asRelativePath(uri)} is not valid review data; not saving.`);
    }
    await ensureStorageDir();
    const text = JSON.stringify(data, null, 2);
    lastSavedText = text;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
    fireReviewDataChanged();
}

export async function saveReviewedFilesData(data: ReviewedFilesData): Promise<void> {
    const uri = getReviewedFilesUri();
    if (!uri) {
        return;
    }
    await ensureStorageDir();
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
}

/**
 * Calls `onExternalChange` when the review data file is created, changed, or deleted by
 * something other than this extension, or when `codeReview.storageDir` moves it.
 */
export function watchReviewData(onExternalChange: () => void): vscode.Disposable {
    let watcher: vscode.FileSystemWatcher | undefined;
    const handle = async () => {
        const uri = getDataFileUri();
        const text = uri ? await readText(uri) : undefined;
        if (text !== undefined && text === lastSavedText) {
            return;
        }
        lastSavedText = text;
        onExternalChange();
    };
    const create = () => {
        watcher?.dispose();
        watcher = undefined;
        const root = getRootUri();
        if (!root) {
            return;
        }
        watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(root, `${getStorageDirSetting()}/${DATA_FILE_NAME}`)
        );
        watcher.onDidCreate(handle);
        watcher.onDidChange(handle);
        watcher.onDidDelete(handle);
    };
    create();
    const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('codeReview.storageDir')) {
            create();
            onExternalChange();
        }
    });
    return new vscode.Disposable(() => {
        watcher?.dispose();
        configListener.dispose();
    });
}

export function relativeFilePath(rootUri: vscode.Uri, fileUri: vscode.Uri): string {
    const rootPrefix = rootUri.path.endsWith('/') ? rootUri.path : `${rootUri.path}/`;
    if (fileUri.path.startsWith(rootPrefix)) {
        return fileUri.path.slice(rootPrefix.length);
    }
    const segments = fileUri.path.split('/');
    return segments[segments.length - 1];
}

export function getCommentCountByFile(data: ReviewData): Map<string, number> {
    const counts = new Map<string, number>();
    for (const thread of data.threads) {
        const current = counts.get(thread.file) ?? 0;
        counts.set(thread.file, current + thread.comments.length);
    }
    return counts;
}

/** Comments grouped by file; `files` limits the result, and all files are included without it. */
export function getCommentsForFiles(data: ReviewData, files?: Iterable<string>): FileCommentsGroup[] {
    const normalizedFiles = files ? new Set(Array.from(files, (file) => file.replace(/\\/g, '/'))) : undefined;
    const groups = new Map<string, FileCommentEntry[]>();

    for (const thread of data.threads) {
        if (normalizedFiles && !normalizedFiles.has(thread.file)) {
            continue;
        }

        const entries = groups.get(thread.file) ?? [];
        for (const comment of thread.comments) {
            entries.push({
                file: thread.file,
                line: thread.line,
                endLine: thread.endLine,
                resolved: thread.resolved,
                comment,
            });
        }
        groups.set(thread.file, entries);
    }

    return Array.from(groups.entries())
        .map(([file, entries]) => ({
            file,
            entries: entries.sort((a, b) => {
                if (a.line !== b.line) {
                    return a.line - b.line;
                }
                return a.comment.timestamp.localeCompare(b.comment.timestamp);
            }),
        }))
        .sort((a, b) => a.file.localeCompare(b.file));
}

import * as vscode from 'vscode';
import { COMMAND_NAMESPACE, COMMENTS_VIEW_ID, CONTEXT_NAMESPACE } from './gitTreeCompare/constants';
import { FileCommentEntry, FileCommentsGroup, getCommentsForFiles, loadReviewData, onDidChangeReviewData } from './reviewStore';

const COMMENTS_VIEW_AS_LIST_STATE_KEY = 'commentsView.asList';

export interface CommentsSelection {
    label: string;
    files: string[];
}

class EmptyStateItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'empty';
    }
}

class CommentItem extends vscode.TreeItem {
    constructor(entry: FileCommentEntry) {
        const startLine = entry.line + 1;
        const endLine = entry.endLine + 1;
        const rangeLabel = startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
        const stateLabel = entry.resolved ? 'resolved' : 'open';
        const preview = entry.comment.body.replace(/\s+/g, ' ').trim();
        super(`${rangeLabel} ${preview}`, vscode.TreeItemCollapsibleState.None);
        this.description = stateLabel;
        this.tooltip = [
            entry.file,
            `${rangeLabel} • ${stateLabel}`,
            entry.comment.author ? `${entry.comment.author} • ${new Date(entry.comment.timestamp).toLocaleString()}` : new Date(entry.comment.timestamp).toLocaleString(),
            '',
            entry.comment.body,
        ].join('\n');
        this.contextValue = 'comment';
        this.command = {
            command: `${COMMAND_NAMESPACE}.openCommentLocation`,
            title: 'Open Comment Location',
            arguments: [entry],
        };
    }
}

class CommentGroupItem extends vscode.TreeItem {
    constructor(readonly group: FileCommentsGroup) {
        super(group.file, vscode.TreeItemCollapsibleState.Expanded);
        this.description = group.entries.length === 1 ? '1 comment' : `${group.entries.length} comments`;
        this.tooltip = group.file;
        this.contextValue = 'commentGroup';
    }
}

export class CodeReviewCommentsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private selection: CommentsSelection | undefined;
    private commentsViewAsList = false;

    constructor() {
        onDidChangeReviewData(() => {
            this.refresh();
        });
    }

    initialize(context: vscode.ExtensionContext): void {
        this.commentsViewAsList = context.workspaceState.get<boolean>(COMMENTS_VIEW_AS_LIST_STATE_KEY, false);
        void this.updateCommentsViewContext();

        context.subscriptions.push(
            vscode.commands.registerCommand(`${COMMAND_NAMESPACE}.toggleCommentsView`, async () => {
                await this.setCommentsViewAsList(context, !this.commentsViewAsList);
            }),
            vscode.commands.registerCommand(`${COMMAND_NAMESPACE}.showCommentsAsTree`, async () => {
                await this.setCommentsViewAsList(context, false);
            }),
            vscode.commands.registerCommand(`${COMMAND_NAMESPACE}.showCommentsAsList`, async () => {
                await this.setCommentsViewAsList(context, true);
            }),
        );
    }

    setSelection(selection: CommentsSelection | undefined): void {
        const nextFiles = selection?.files.join('\n');
        const currentFiles = this.selection?.files.join('\n');
        if (this.selection?.label === selection?.label && currentFiles === nextFiles) {
            return;
        }
        this.selection = selection;
        this.refresh();
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (element instanceof CommentGroupItem) {
            return element.group.entries.map((entry) => new CommentItem(entry));
        }
        if (element) {
            return [];
        }

        if (!vscode.workspace.workspaceFolders?.[0]?.uri) {
            return [new EmptyStateItem('Open a workspace to view comments')];
        }
        // Without a selection in the Changes tree, show every comment in the workspace.
        const data = await loadReviewData();
        const scoped = this.selection && this.selection.files.length > 0 ? this.selection : undefined;
        const groups = getCommentsForFiles(data, scoped?.files);
        if (groups.length === 0) {
            return [new EmptyStateItem(scoped ? `No comments for ${scoped.label}` : 'No review comments yet')];
        }

        if (this.commentsViewAsList || groups.length === 1) {
            return groups.flatMap((group) => group.entries.map((entry) => new CommentItem(entry)));
        }

        return groups.map((group) => new CommentGroupItem(group));
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    private async setCommentsViewAsList(context: vscode.ExtensionContext, value: boolean): Promise<void> {
        if (this.commentsViewAsList === value) {
            return;
        }
        this.commentsViewAsList = value;
        await context.workspaceState.update(COMMENTS_VIEW_AS_LIST_STATE_KEY, value);
        await this.updateCommentsViewContext();
        this.refresh();
    }

    private async updateCommentsViewContext(): Promise<void> {
        await vscode.commands.executeCommand('setContext', `${CONTEXT_NAMESPACE}.commentsViewAsList`, this.commentsViewAsList);
    }
}

export function registerCommentsView(context: vscode.ExtensionContext, provider: CodeReviewCommentsProvider): void {
    provider.initialize(context);

    const treeView = vscode.window.createTreeView(COMMENTS_VIEW_ID, {
        treeDataProvider: provider,
        canSelectMany: false,
    });

    context.subscriptions.push(treeView);
}

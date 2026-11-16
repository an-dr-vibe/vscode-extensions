import * as vscode from 'vscode';

/**
 * The file shown in the active editor tab, whatever kind of editor shows it.
 *
 * `window.activeTextEditor` is undefined while a custom editor (for example a
 * Markdown WYSIWYG editor), a notebook, or an image preview has focus, so the
 * active tab is asked first. Diff tabs resolve to their modified side.
 * Returns undefined when the active tab shows no file on disk.
 */
export function activeFileUri(): vscode.Uri | undefined {
    const uri = tabUri(vscode.window.tabGroups.activeTabGroup.activeTab?.input)
        ?? vscode.window.activeTextEditor?.document.uri;
    return uri?.scheme === 'file' ? uri : undefined;
}

function tabUri(input: unknown): vscode.Uri | undefined {
    if (input instanceof vscode.TabInputText
        || input instanceof vscode.TabInputCustom
        || input instanceof vscode.TabInputNotebook) {
        return input.uri;
    }
    if (input instanceof vscode.TabInputTextDiff
        || input instanceof vscode.TabInputNotebookDiff) {
        return input.modified;
    }
    return undefined;
}

/** Fires when the active tab may have changed to another file. */
export function onDidChangeActiveFile(listener: () => void): vscode.Disposable {
    return vscode.Disposable.from(
        vscode.window.onDidChangeActiveTextEditor(listener),
        vscode.window.tabGroups.onDidChangeTabs(listener),
        vscode.window.tabGroups.onDidChangeTabGroups(listener),
    );
}

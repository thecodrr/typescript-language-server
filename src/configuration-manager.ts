import deepmerge from 'deepmerge';
import path from 'node:path';
import type * as lsp from 'vscode-languageserver';
import { LspDocuments } from './document.js';
import { tsp, TypeScriptInitializationOptions } from './ts-protocol.js';
import type { TspClient } from './tsp-client.js';
import API from './utils/api.js';

const DEFAULT_TSSERVER_PREFERENCES: Required<tsp.UserPreferences> = {
    allowIncompleteCompletions: true,
    allowRenameOfImportPath: true,
    allowTextChangesInNewFiles: true,
    autoImportFileExcludePatterns: [],
    disableLineTextInReferences: true,
    disableSuggestions: false,
    displayPartsForJSDoc: true,
    generateReturnInDocTemplate: true,
    importModuleSpecifierEnding: 'auto',
    importModuleSpecifierPreference: 'shortest',
    includeAutomaticOptionalChainCompletions: true,
    includeCompletionsForImportStatements: true,
    includeCompletionsForModuleExports: true,
    includeCompletionsWithClassMemberSnippets: true,
    includeCompletionsWithInsertText: true,
    includeCompletionsWithObjectLiteralMethodSnippets: true,
    includeCompletionsWithSnippetText: true,
    includeInlayEnumMemberValueHints: false,
    includeInlayFunctionLikeReturnTypeHints: false,
    includeInlayFunctionParameterTypeHints: false,
    includeInlayParameterNameHints: 'none',
    includeInlayParameterNameHintsWhenArgumentMatchesName: false,
    includeInlayPropertyDeclarationTypeHints: false,
    includeInlayVariableTypeHints: false,
    includeInlayVariableTypeHintsWhenTypeMatchesName: false,
    includePackageJsonAutoImports: 'auto',
    jsxAttributeCompletionStyle: 'auto',
    lazyConfiguredProjectsFromExternalProject: false,
    providePrefixAndSuffixTextForRename: true,
    provideRefactorNotApplicableReason: true,
    quotePreference: 'auto',
    useLabelDetailsInCompletionEntries: true,
};

const DEFAULT_IMPLICIT_PROJECT_CONFIGURATION: Required<WorkspaceConfigurationImplicitProjectConfigurationOptions> = {
    checkJs: false,
    experimentalDecorators: false,
    module: tsp.ModuleKind.ESNext,
    strictFunctionTypes: true,
    strictNullChecks: true,
    target: tsp.ScriptTarget.ES2020,
};

const DEFAULT_WORKSPACE_CONFIGURATION: WorkspaceConfiguration = {
    implicitProjectConfiguration: DEFAULT_IMPLICIT_PROJECT_CONFIGURATION,
};

export interface WorkspaceConfiguration {
    javascript?: WorkspaceConfigurationLanguageOptions;
    typescript?: WorkspaceConfigurationLanguageOptions;
    completions?: WorkspaceConfigurationCompletionOptions;
    diagnostics?: WorkspaceConfigurationDiagnosticsOptions;
    implicitProjectConfiguration?: WorkspaceConfigurationImplicitProjectConfigurationOptions;
}

export interface WorkspaceConfigurationLanguageOptions {
    format?: tsp.FormatCodeSettings;
    inlayHints?: TypeScriptInlayHintsPreferences;
}

export interface WorkspaceConfigurationImplicitProjectConfigurationOptions {
    checkJs?: boolean;
    experimentalDecorators?: boolean;
    module?: string;
    strictFunctionTypes?: boolean;
    strictNullChecks?: boolean;
    target?: string;
}

/* eslint-disable @typescript-eslint/indent */
export type TypeScriptInlayHintsPreferences = Pick<
    tsp.UserPreferences,
    'includeInlayParameterNameHints' |
    'includeInlayParameterNameHintsWhenArgumentMatchesName' |
    'includeInlayFunctionParameterTypeHints' |
    'includeInlayVariableTypeHints' |
    'includeInlayVariableTypeHintsWhenTypeMatchesName' |
    'includeInlayPropertyDeclarationTypeHints' |
    'includeInlayFunctionLikeReturnTypeHints' |
    'includeInlayEnumMemberValueHints'
>;
/* eslint-enable @typescript-eslint/indent */

interface WorkspaceConfigurationDiagnosticsOptions {
    ignoredCodes?: number[];
}

export interface WorkspaceConfigurationCompletionOptions {
    completeFunctionCalls?: boolean;
}

export class ConfigurationManager {
    public tsPreferences: Required<tsp.UserPreferences> = deepmerge({}, DEFAULT_TSSERVER_PREFERENCES);
    public workspaceConfiguration: WorkspaceConfiguration = deepmerge({}, DEFAULT_WORKSPACE_CONFIGURATION);
    private tspClient: TspClient | null = null;

    constructor(private readonly documents: LspDocuments) {}

    public mergeTsPreferences(preferences: tsp.UserPreferences): void {
        this.tsPreferences = deepmerge(this.tsPreferences, preferences);
    }

    public setWorkspaceConfiguration(configuration: WorkspaceConfiguration): void {
        this.workspaceConfiguration = deepmerge(DEFAULT_WORKSPACE_CONFIGURATION, configuration);
    }

    public setAndConfigureTspClient(workspaceFolder: string | undefined, client: TspClient, hostInfo?: TypeScriptInitializationOptions['hostInfo']): void {
        this.tspClient = client;
        const formatOptions: tsp.FormatCodeSettings = {
            // We can use \n here since the editor should normalize later on to its line endings.
            newLineCharacter: '\n',
        };
        const args: tsp.ConfigureRequestArguments = {
            ...hostInfo ? { hostInfo } : {},
            formatOptions,
            preferences: {
                ...this.tsPreferences,
                autoImportFileExcludePatterns: this.getAutoImportFileExcludePatternsPreference(workspaceFolder),
            },
        };
        client.executeWithoutWaitingForResponse(tsp.CommandTypes.Configure, args);
    }

    public async configureGloballyFromDocument(filename: string, formattingOptions?: lsp.FormattingOptions): Promise<void> {
        const args: tsp.ConfigureRequestArguments = {
            formatOptions: this.getFormattingOptions(filename, formattingOptions),
            preferences: this.getPreferences(filename),
        };
        await this.tspClient?.request(tsp.CommandTypes.Configure, args);
    }

    public getPreferences(filename: string): tsp.UserPreferences {
        if (this.tspClient?.apiVersion.lt(API.v290)) {
            return {};
        }

        const workspacePreferences = this.getWorkspacePreferencesForFile(filename);
        const preferences = Object.assign<tsp.UserPreferences, tsp.UserPreferences, tsp.UserPreferences>(
            {},
            this.tsPreferences,
            workspacePreferences?.inlayHints || {},
        );

        return {
            ...preferences,
            quotePreference: this.getQuoteStylePreference(preferences),
        };
    }

    private getFormattingOptions(filename: string, formattingOptions?: lsp.FormattingOptions): tsp.FormatCodeSettings {
        const workspacePreferences = this.getWorkspacePreferencesForFile(filename);

        const opts: tsp.FormatCodeSettings = {
            ...workspacePreferences?.format,
            ...formattingOptions,
        };

        if (opts.convertTabsToSpaces === undefined) {
            opts.convertTabsToSpaces = formattingOptions?.insertSpaces;
        }
        if (opts.indentSize === undefined) {
            opts.indentSize = formattingOptions?.tabSize;
        }

        return opts;
    }

    private getQuoteStylePreference(preferences: tsp.UserPreferences) {
        switch (preferences.quotePreference) {
            case 'single': return 'single';
            case 'double': return 'double';
            default: return this.tspClient?.apiVersion.gte(API.v333) ? 'auto' : undefined;
        }
    }

    private getWorkspacePreferencesForFile(filename: string): WorkspaceConfigurationLanguageOptions {
        const document = this.documents.get(filename);
        const languageId = document?.languageId.startsWith('typescript') ? 'typescript' : 'javascript';
        return this.workspaceConfiguration[languageId] || {};
    }

    private getAutoImportFileExcludePatternsPreference(workspaceFolder: string | undefined): string[] | undefined {
        if (!workspaceFolder || this.tsPreferences.autoImportFileExcludePatterns.length === 0) {
            return;
        }
        return this.tsPreferences.autoImportFileExcludePatterns.map(p => {
            // Normalization rules: https://github.com/microsoft/TypeScript/pull/49578
            const slashNormalized = p.replace(/\\/g, '/');
            const isRelative = /^\.\.?($|\/)/.test(slashNormalized);
            return path.posix.isAbsolute(p) ? p :
                p.startsWith('*') ? '/' + slashNormalized :
                    isRelative ? path.posix.join(workspaceFolder, p) :
                        '/**/' + slashNormalized;
        });
    }
}

export type FragmentMethod =
  | 'textDocument/didOpen'
  | 'textDocument/didChange'
  | 'textDocument/didClose'
  | 'fragments/action/applyFragments'
  | 'fragments/action/saveFragments'
  | 'fragments/action/changeVersion'
  | 'fragments/action/generateMarker'
  | 'fragments/action/init'
  | 'fragments/query/getVersion'
  | 'fragments/query/getFragmentPositions'
  | 'fragments/query/getAllFragmentRanges'
  | 'fragments/event/didPersistDocument';

export interface FragmentRequestMessage<TMethod extends FragmentMethod = FragmentMethod> {
  id: number;
  method: TMethod;
  params: FragmentRequestParams[TMethod];
}

export interface FragmentResponseMessage<TMethod extends FragmentMethod = FragmentMethod> {
  id: number;
  result?: FragmentResponseResults[TMethod];
  error?: FragmentError;
}

export interface FragmentError {
  code: number;
  message: string;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface TextDocumentItem extends TextDocumentIdentifier {
  text: string;
  version: number;
}

export interface TextDocumentDidOpenParams {
  textDocument: TextDocumentItem;
}

export interface TextDocumentDidChangeParams {
  textDocument: {
    uri: string;
    version: number;
  };
  contentChanges: Array<{ text: string }>;
}

export interface TextDocumentDidCloseParams {
  textDocument: TextDocumentIdentifier;
}

export interface ApplyFragmentsParams {
  textDocument?: TextDocumentIdentifier;
  filePath?: string;
}

export interface FragmentApplyResult {
  success: true;
  newContent: string;
  appliedCount: number;
  hasChanges: boolean;
}

export interface SaveFragmentsParams {
  textDocument?: TextDocumentIdentifier;
  filePath?: string;
}

export interface FragmentIssue {
  type: 'nested-fragment';
  fragmentId: string;
  parentFragmentId: string;
  startLine: number;
  endLine: number;
  message: string;
}

export interface FragmentSaveSuccess {
  success: true;
  activeVersion: string;
  fragmentsSaved: number;
  issues?: undefined;
}

export interface FragmentSaveFailure {
  success: false;
  activeVersion: string;
  fragmentsSaved: 0;
  issues: FragmentIssue[];
}

export type FragmentSaveResult = FragmentSaveSuccess | FragmentSaveFailure;

export interface ChangeVersionParams {
  version: string;
}

export interface FragmentDocumentChange {
  uri: string;
  content: string;
  revision: number;
}

export interface FragmentChangeVersionResult {
  success: true;
  version: string;
  documents: FragmentDocumentChange[];
  removedUris: string[];
}

export interface GenerateMarkerParams {
  languageId: string;
  lineContent?: string;
  indentation?: string;
}

export interface FragmentGenerateMarkerResult {
  success: true;
  fragmentId: string;
  markerText: string;
  insertPosition: 'line-end' | 'new-line';
}

export interface FragmentVersionInfo {
  activeVersion: string;
  availableVersions: string[];
  initialized: boolean;
}

export interface FragmentMarkerRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  isStartMarker: boolean;
  isEndMarker: boolean;
  fragmentId: string;
}

export interface FragmentMarkerRangesResult {
  success: true;
  markerRanges: FragmentMarkerRange[];
}

export interface FragmentAllRangesResult {
  success: true;
  fragments: Array<{
    id: string;
    startLine: number;
    endLine: number;
  }>;
}

export interface InitParams {
  versions?: string[];
  activeVersion?: string;
}

export interface FragmentInitResult {
  success: true;
  message: string;
}

export interface FragmentOperationResult {
  success: true;
}

export interface DidPersistDocumentParams {
  uri: string;
  revision: number;
}

export type FragmentRequestParams = {
  'textDocument/didOpen': TextDocumentDidOpenParams;
  'textDocument/didChange': TextDocumentDidChangeParams;
  'textDocument/didClose': TextDocumentDidCloseParams;
  'fragments/action/applyFragments': ApplyFragmentsParams;
  'fragments/action/saveFragments': SaveFragmentsParams;
  'fragments/action/changeVersion': ChangeVersionParams;
  'fragments/action/generateMarker': GenerateMarkerParams;
  'fragments/action/init': InitParams;
  'fragments/query/getVersion': Record<string, never>;
  'fragments/query/getFragmentPositions': { textDocument: TextDocumentIdentifier; line: number };
  'fragments/query/getAllFragmentRanges': { textDocument: TextDocumentIdentifier };
  'fragments/event/didPersistDocument': DidPersistDocumentParams;
};

export type FragmentResponseResults = {
  'textDocument/didOpen': FragmentOperationResult;
  'textDocument/didChange': FragmentOperationResult;
  'textDocument/didClose': FragmentOperationResult;
  'fragments/action/applyFragments': FragmentApplyResult;
  'fragments/action/saveFragments': FragmentSaveResult;
  'fragments/action/changeVersion': FragmentChangeVersionResult;
  'fragments/action/generateMarker': FragmentGenerateMarkerResult;
  'fragments/action/init': FragmentInitResult;
  'fragments/query/getVersion': FragmentVersionInfo;
  'fragments/query/getFragmentPositions': FragmentMarkerRangesResult;
  'fragments/query/getAllFragmentRanges': FragmentAllRangesResult;
  'fragments/event/didPersistDocument': FragmentOperationResult;
};

export type FragmentRequestHandler<TMethod extends FragmentMethod> = (
  params: FragmentRequestParams[TMethod]
) => Promise<FragmentResponseResults[TMethod]>;

export type FragmentHandlers = {
  [K in FragmentMethod]: FragmentRequestHandler<K>;
};
